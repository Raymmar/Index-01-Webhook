import { useCallback, useEffect, useRef, useState } from 'react';
import { useDeleteItem, useRestoreItem, type ActionItem } from '@workspace/api-client-react';

export const TASK_UNDO_MS = 15_000;
type Notice = { item: ActionItem; expiresAt: number; state: 'ready' | 'restoring' | 'expired' | 'restored'; error?: string };

// Keep a separate notice per deletion, so rapid deletions never steal an Undo.
export function useTaskUndo(onChanged: () => void, message: (error: unknown) => string) {
  const del = useDeleteItem();
  const restore = useRestoreItem();
  const [notices, setNotices] = useState<Notice[]>([]);
  const busy = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const expire = useCallback(() => setNotices(rows => rows.map(row =>
    row.state === 'ready' && Date.now() >= row.expiresAt ? { ...row, state: 'expired', error: undefined } : row)), []);
  useEffect(() => {
    if (!notices.some(row => row.state === 'ready')) return;
    const timer = setInterval(expire, 250);
    return () => clearInterval(timer);
  }, [notices, expire]);
  async function remove(item: ActionItem) {
    if (busy.current.has(item.id)) return;
    busy.current.add(item.id);
    // Start before the request: slow responses must not extend the server's window.
    const expiresAt = Date.now() + TASK_UNDO_MS;
    try {
      await del.mutateAsync({ id: item.id });
      if (mounted.current) setNotices(rows => [...rows.filter(row => row.item.id !== item.id), {
        item, expiresAt, state: Date.now() < expiresAt ? 'ready' : 'expired',
      }]);
    } finally {
      busy.current.delete(item.id);
      onChanged();
    }
  }
  async function undo(id: string) {
    const notice = notices.find(row => row.item.id === id);
    if (!notice || notice.state !== 'ready' || busy.current.has(id)) return;
    if (Date.now() >= notice.expiresAt) { expire(); return; }
    busy.current.add(id);
    setNotices(rows => rows.map(row => row.item.id === id ? { ...row, state: 'restoring', error: undefined } : row));
    try {
      await restore.mutateAsync({ id });
      if (mounted.current) setNotices(rows => rows.map(row => row.item.id === id ? { ...row, state: 'restored' } : row));
    } catch (error) {
      const terminal = [404, 410].includes((error as { status?: number })?.status ?? 0);
      if (mounted.current) setNotices(rows => rows.map(row => row.item.id === id ? {
        ...row, state: terminal || Date.now() >= row.expiresAt ? 'expired' : 'ready', error: message(error),
      } : row));
    } finally {
      busy.current.delete(id);
      onChanged();
    }
  }
  return { notices, remove, undo, deleting: del.isPending, dismiss: (id: string) => setNotices(rows => rows.filter(row => row.item.id !== id)) };
}
