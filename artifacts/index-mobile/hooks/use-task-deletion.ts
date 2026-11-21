import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteItem, refreshInbox } from '@workspace/api-client-react';

/** Mobile deletions are quiet on success; callers present actionable failures. */
export function useTaskDeletion(onChanged: () => void) {
  const deletion = useDeleteItem();
  const client = useQueryClient();
  const active = useRef(new Map<string, Promise<void>>());
  function remove(item: { id: string }) {
    const pending = active.current.get(item.id);
    if (pending) return pending;
    const request = deletion.mutateAsync({ id: item.id }).finally(() => {
      active.current.delete(item.id);
      void refreshInbox(client);
      onChanged();
    });
    active.current.set(item.id, request);
    return request;
  }
  return { remove, deleting: deletion.isPending };
}
