import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import {
  useGetOrganizer, useUpdateItem, useConfirmationPreferences, tasksForMessage,
  getGetOrganizerQueryKey, getListEventsQueryKey,
  type ActionItem, type Organizer,
} from '@workspace/api-client-react';
import { ItemEditor } from './item-editor';
import { Button, Confirm, Copy, IconButton, Sheet, c, s, errorMessage } from './ui';
import { useTaskUndo } from '@/hooks/use-task-undo';
import { compareTasks } from '@/lib/task-order';

/** The inbox and dashboard operate on the same server-owned tasks/cache. */
export function LinkedTasks({ eventId, tz }: { eventId: string; tz: string }) {
  const organizer = useGetOrganizer();
  const qc = useQueryClient();
  const update = useUpdateItem();
  const preferences = useConfirmationPreferences();
  const [editor, setEditor] = useState<ActionItem | null>(null);
  const [menu, setMenu] = useState<ActionItem | null>(null);
  const [confirm, setConfirm] = useState<{ item: ActionItem; kind: 'dismiss' | 'delete' } | null>(null);
  const [error, setError] = useState('');
  const working = useRef(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() });
    void qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
  };
  const undo = useTaskUndo(refresh, errorMessage);
  const tasks = tasksForMessage(organizer.data?.items ?? [], eventId);
  const busy = update.isPending || undo.deleting;

  async function change(item: ActionItem, action: 'open' | 'completed' | 'dismissed' | 'delete') {
    if (working.current) return;
    working.current = true;
    setError('');
    try {
      const saved = action === 'delete' ? (await undo.remove(item), null)
        : await update.mutateAsync({ id: item.id, data: { status: action } });
      await qc.cancelQueries({ queryKey: getGetOrganizerQueryKey() });
      qc.setQueryData<Organizer>(getGetOrganizerQueryKey(), previous => previous && ({
        ...previous,
        items: saved ? previous.items.map(row => row.id === item.id ? { ...row, ...saved } : row)
          : previous.items.filter(row => row.id !== item.id),
      }));
      setMenu(null);
      setConfirm(null);
    } catch (e) { setError(errorMessage(e)); }
    finally { working.current = false; refresh(); }
  }
  function request(item: ActionItem, kind: 'dismiss' | 'delete') {
    setMenu(null); setError('');
    if (preferences.skips(kind === 'dismiss' ? 'skipTaskDismissConfirmation' : 'skipTaskDeleteConfirmation')) {
      void change(item, kind === 'dismiss' ? 'dismissed' : 'delete');
    } else setConfirm({ item, kind });
  }
  const notices = undo.notices.filter(notice => notice.state === 'ready' || notice.state === 'restoring');
  if (!tasks.length && !notices.length && !error) return null;
  return <View testID={`linked-tasks-${eventId}`} onTouchStart={event => event.stopPropagation()}>
    {tasks.map(item => <View key={item.id} testID={`linked-task-${item.id}`} style={[s.row, { borderTopWidth: 1, borderColor: c.border, paddingVertical: 8, gap: 4, alignItems: 'flex-start' }]}>
      <IconButton name={item.status === 'completed' ? 'check-circle' : item.status === 'dismissed' ? 'rotate-ccw' : 'circle'} label={`${item.status === 'open' ? 'Complete' : 'Reopen'} ${item.title}`} disabled={busy} onPress={() => void change(item, item.status === 'open' ? 'completed' : 'open')} color={item.status === 'completed' ? c.success : c.mutedForeground} />
      <Pressable testID={`edit-linked-task-${item.id}`} accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} disabled={busy} onPress={() => { setError(''); setEditor(item); }} style={{ flex: 1, minWidth: 0, paddingVertical: 9 }}>
        <Copy style={{ textDecorationLine: item.status === 'open' ? 'none' : 'line-through', color: item.status === 'open' ? c.foreground : c.mutedForeground }}>{item.title}</Copy>
        <Text style={s.muted}>{item.dueAt ? formatInTimeZone(item.dueAt, tz, 'MMM d · h:mm a') : 'No date'}{item.status !== 'open' ? ` · ${item.status === 'completed' ? 'Completed' : 'Dismissed'}` : ''}</Text>
        {item.needsReview && <Text style={[s.muted, { color: c.accent }]}>Check time{item.originalTimeText ? `: “${item.originalTimeText}”` : ''}</Text>}
      </Pressable>
      <IconButton name="more-vertical" size={18} label={`Actions for ${item.title}`} disabled={busy} onPress={() => { setError(''); setMenu(item); }} />
    </View>)}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {notices.map(notice => <View key={notice.item.id} style={{ gap: 6, paddingVertical: 8 }}>
      <Text style={s.muted}>Deleted “{notice.item.title}”.</Text>
      {!!notice.error && <Text style={s.error}>{notice.error}</Text>}
      <Button testID={`undo-linked-task-${notice.item.id}`} quiet label={notice.state === 'restoring' ? 'Restoring…' : 'Undo'} disabled={notice.state === 'restoring'} onPress={() => void undo.undo(notice.item.id)} />
    </View>)}
    {editor && <ItemEditor item={editor} tasks={tasks} tz={tz} onClose={() => setEditor(null)} />}
    {menu && <Sheet visible title="Task actions" onClose={() => setMenu(null)}>
      <Copy>{menu.title}</Copy>
      <Button quiet label="Edit task" onPress={() => { setEditor(menu); setMenu(null); }} />
      <Button quiet label={menu.status === 'dismissed' ? 'Restore task' : 'Dismiss task'} disabled={busy} onPress={() => menu.status === 'dismissed' ? void change(menu, 'open') : request(menu, 'dismiss')} />
      <Button danger label="Delete task" disabled={busy} onPress={() => request(menu, 'delete')} />
      {!!error && <Text style={s.error}>{error}</Text>}
    </Sheet>}
    {confirm && <Confirm preference={confirm.kind === 'dismiss' ? 'skipTaskDismissConfirmation' : 'skipTaskDeleteConfirmation'} title={confirm.kind === 'dismiss' ? 'Dismiss task' : 'Delete task'} message={confirm.kind === 'dismiss' ? 'It moves out of your open list. You can restore it later from Dismissed.' : 'Remove only this task. The original message, audio, and other tasks remain unchanged. Undo is available for 15 seconds.'} pending={busy} error={error || undefined} onClose={() => setConfirm(null)} onConfirm={() => change(confirm.item, confirm.kind === 'dismiss' ? 'dismissed' : 'delete')} />}
  </View>;
}
