import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteItem, useRestoreItem, TaskDeletion, refreshInbox } from '@workspace/api-client-react';
export { TASK_UNDO_MS } from '@workspace/api-client-react';

export function useTaskUndo(onChanged: () => void, _message: (error: unknown) => string) {
  const del = useDeleteItem();
  const restore = useRestoreItem();
  const client = useQueryClient();
  const latest = useRef({ del, restore, onChanged });
  latest.current = { del, restore, onChanged };
  const [deletion] = useState(() => new TaskDeletion({
    remove: id => latest.current.del.mutateAsync({ id }),
    restore: id => latest.current.restore.mutateAsync({ id }),
    changed: () => { void refreshInbox(client); latest.current.onChanged(); },
  }));
  const notices = useSyncExternalStore(deletion.subscribe, deletion.snapshot);
  useEffect(() => {
    deletion.expire();
    const next = Math.min(...notices.filter(row => row.state === 'ready').map(row => row.expiresAt));
    const timer = Number.isFinite(next) ? setTimeout(deletion.expire, Math.max(0, next - Date.now())) : undefined;
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') deletion.expire(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [notices, deletion]);
  return {
    notices: notices.map(row => ({ ...row, item: { id: row.id, title: row.title } })),
    remove: deletion.remove.bind(deletion), undo: deletion.undo.bind(deletion),
    deleting: del.isPending, dismiss: deletion.dismiss,
  };
}
