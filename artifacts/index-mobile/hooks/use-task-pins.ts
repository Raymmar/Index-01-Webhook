import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePinItem, useUnpinItem, getGetOrganizerQueryKey, getListEventsQueryKey, type ActionItem, type Organizer } from '@workspace/api-client-react';

type Intent = { desired: boolean; reconciling: boolean };

/** Serialize per task, toggling the latest intent rather than a rendered snapshot. */
export function useTaskPins(onError: (error: unknown) => void) {
  const qc = useQueryClient();
  const pin = usePinItem();
  const unpin = useUnpinItem();
  const intents = useRef(new Map<string, Intent>());
  const [, render] = useState(0);
  const changed = () => render(n => n + 1);
  const intended = (item: ActionItem) => intents.current.get(item.id)?.desired ??
    !!(qc.getQueryData<Organizer>(getGetOrganizerQueryKey())?.items.find(row => row.id === item.id) ?? item).pinnedAt;

  async function request(item: ActionItem, desired: boolean) {
    const existing = intents.current.get(item.id);
    if (existing) {
      if (!existing.reconciling) { existing.desired = desired; changed(); }
      return;
    }
    const intent: Intent = { desired, reconciling: false };
    intents.current.set(item.id, intent);
    changed();
    try {
      let actual: boolean;
      do {
        const target = intent.desired;
        const saved = await (target ? pin : unpin).mutateAsync({ id: item.id });
        await qc.cancelQueries({ queryKey: getGetOrganizerQueryKey() });
        qc.setQueryData<Organizer>(getGetOrganizerQueryKey(), previous => previous && ({
          ...previous, items: previous.items.map(row => row.id === item.id ? { ...row, ...saved } : row),
        }));
        actual = !!saved.pinnedAt;
      } while (actual !== intent.desired);
    } catch (error) {
      intent.reconciling = true;
      changed();
      onError(error);
      // A failed response may have followed a successful server write.
      await qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() });
    } finally {
      intents.current.delete(item.id);
      changed();
      void qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() });
      void qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
    }
  }
  return {
    intended,
    pending: (id: string) => intents.current.has(id),
    acceptsToggle: (id: string) => !!intents.current.get(id) && !intents.current.get(id)!.reconciling,
    toggle: (item: ActionItem) => request(item, !intended(item)),
    set: request,
  };
}
