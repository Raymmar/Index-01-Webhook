import { useRef, useState, type ElementRef } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { addDays, format, startOfWeek } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useGetOrganizer, useGetSettings, useUpdateItem, usePinItem, getGetOrganizerQueryKey, getListEventsQueryKey, type Organizer, type ActionItem, type ItemUpdate } from '@workspace/api-client-react';
import { Page, Copy, Skeleton, Failure, Empty, IconButton, Button, Confirm, Sheet, s, c, errorMessage } from '@/components/ui';
import { ItemEditor } from '@/components/item-editor';
import { deviceZone, useLive } from '@/lib/session';
import { useHorizontalSwipe } from '@/hooks/use-horizontal-swipe';
import { SwipeTaskRow } from '@/components/swipe-task-row';
import { compareTasks } from '@/lib/task-order';
import { useUnpinItem } from '@workspace/api-client-react';
import { useTaskUndo } from '@/hooks/use-task-undo';
import { TaskUndoMessages } from '@/components/task-undo-messages';

type TaskStatus = 'open' | 'completed' | 'dismissed';
const statusLabels: Record<TaskStatus, string> = { open: 'Open', completed: 'Completed', dismissed: 'Dismissed' };

function StatusDropdown({ value, onChange }: { value: TaskStatus; onChange: (value: TaskStatus) => void }) {
  const trigger = useRef<ElementRef<typeof View>>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const menuWidth = 164;
  const menuHeight = 148;
  return <>
    <Pressable ref={trigger} testID="dashboard-status-dropdown" accessibilityRole="button" accessibilityLabel={`Task status: ${statusLabels[value]}`} accessibilityState={{ expanded: !!anchor }} onPress={() => trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }))} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, opacity: pressed ? 0.6 : 1 })}>
      <Text numberOfLines={1} style={[s.muted, { fontSize: 11, color: c.foreground, fontFamily: 'Geist_500Medium' }]}>{statusLabels[value]}</Text><Feather name="chevron-down" size={13} color={c.mutedForeground} />
    </Pressable>
    <Modal visible={!!anchor} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAnchor(null)}>
      <View style={{ flex: 1 }} onAccessibilityEscape={() => setAnchor(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close status menu" onPress={() => setAnchor(null)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        {anchor && <View accessibilityViewIsModal style={[s.card, { position: 'absolute', left: Math.max(8, Math.min(anchor.x + anchor.width - menuWidth, windowWidth - menuWidth - 8)), top: Math.max(8, Math.min(anchor.y + anchor.height + 4, windowHeight - menuHeight - 34)), width: menuWidth, padding: 5, gap: 0, elevation: 6, shadowColor: c.foreground, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12 }]}>
          {(['open', 'completed', 'dismissed'] as const).map(status => <Pressable key={status} testID={`dashboard-status-${status}`} accessibilityRole="radio" accessibilityState={{ checked: status === value }} onPress={() => { onChange(status); setAnchor(null); }} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 10, borderRadius: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: pressed || status === value ? c.secondary : 'transparent' })}><Text style={[s.text, { fontSize: 13 }]}>{statusLabels[status]}</Text>{status === value && <Feather name="check" size={15} color={c.accent} />}</Pressable>)}
        </View>}
      </View>
    </Modal>
  </>;
}

export default function Dashboard() {
  const q = useGetOrganizer();
  const settings = useGetSettings();
  const tz = settings.data?.timezone ?? deviceZone();
  const live = useLive();
  const [filter, setFilter] = useState<'all' | 'scheduled' | 'unscheduled'>('all');
  const [status, setStatus] = useState<TaskStatus>('open');
  const [week, setWeek] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [editor, setEditor] = useState<ActionItem | 'new' | null>(null);
  const [editorTasks, setEditorTasks] = useState<ActionItem[]>([]);
  const [menu, setMenu] = useState<ActionItem | null>(null);
  const [confirm, setConfirm] = useState<{ item: ActionItem; kind: 'note' | 'delete' } | null>(null);
  const [error, setError] = useState('');
  const update = useUpdateItem();
  const pin = usePinItem();
  const unpin = useUnpinItem();
  const pending = useRef(new Set<string>());
  const pendingPins = useRef(new Set<string>());
  const queuedPins = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState(new Set<string>());
  const qc = useQueryClient();
  const invalidate = () => { void qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }); void qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); };
  const undo = useTaskUndo(invalidate, errorMessage);
  async function removeTask(item: ActionItem) {
    setError('');
    try {
      await undo.remove(item);
      await qc.cancelQueries({ queryKey: getGetOrganizerQueryKey() });
      qc.setQueryData<Organizer>(getGetOrganizerQueryKey(), previous => previous && ({
        ...previous, items: previous.items.filter(row => row.id !== item.id),
      }));
      setConfirm(null);
      invalidate();
    } catch (e) { setError(errorMessage(e)); }
  }
  async function taskAction(item: ActionItem, kind: 'pin' | 'delete' | 'unpin') {
    if (kind === 'pin' && pendingPins.current.has(item.id)) { queuedPins.current.add(item.id); return; }
    if (pending.current.has(item.id) || update.isPending) return;
    pending.current.add(item.id);
    if (kind !== 'delete') pendingPins.current.add(item.id);
    setPendingIds(new Set(pending.current));
    setError('');
    try {
      const saved = kind === 'pin' ? await pin.mutateAsync({ id: item.id }) : kind === 'unpin' ? await unpin.mutateAsync({ id: item.id }) : await update.mutateAsync({ id: item.id, data: { status: 'dismissed' } });
      // Cancel in-flight reads before applying the authoritative mutation response.
      await qc.cancelQueries({ queryKey: getGetOrganizerQueryKey() });
      qc.setQueryData<Organizer>(getGetOrganizerQueryKey(), previous => previous && ({
        ...previous, items: previous.items.map(row => row.id === item.id ? { ...row, ...saved } : row),
      }));
      setMenu(null);
    } catch (e) { setError(errorMessage(e)); }
    finally {
      pending.current.delete(item.id);
      pendingPins.current.delete(item.id);
      setPendingIds(new Set(pending.current));
      if (queuedPins.current.delete(item.id)) void taskAction(item, 'pin');
      else invalidate();
    }
  }
  function patch(item: ActionItem, data: ItemUpdate) {
    if (pending.current.has(item.id)) return;
    setError('');
    update.mutate({ id: item.id, data }, { onSuccess: () => { invalidate(); setMenu(null); setConfirm(null); }, onError: e => setError(errorMessage(e)) });
  }
  const items = q.data?.items ?? [];
  const open = items.filter(i => i.status === 'open');
  const todayKey = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
  const today = new Date(`${todayKey}T12:00:00`);
  const first = addDays(startOfWeek(today, { weekStartsOn: 1 }), week * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const dayOf = (value: string) => formatInTimeZone(value, tz, 'yyyy-MM-dd');
  const visible = items.filter(i => i.status === status && (filter === 'all' || (filter === 'scheduled' ? !!i.dueAt : !i.dueAt)) && (!date || (!!i.dueAt && dayOf(i.dueAt) === date))).sort(compareTasks);
  function openEditor(item: ActionItem) {
    setEditorTasks([...visible]);
    setEditor(item);
  }
  function changeWeek(direction: 'next' | 'previous') {
    setWeek(w => w + (direction === 'next' ? 1 : -1));
    setDate(null);
  }
  const calendarSwipe = useHorizontalSwipe(changeWeek);
  return <View style={{ flex: 1 }}><Page compact title="Dashboard" action={<View style={[s.row, { gap: 4 }]}><View style={[s.row, { gap: 5 }]}><View style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: live === 'live' ? c.accent : c.mutedForeground }} /><Text style={[s.muted, { fontSize: 10 }]}>{live === 'live' ? 'Live' : live === 'paused' ? 'Paused' : 'Connecting'}</Text></View><IconButton name="plus" label="New task" onPress={() => setEditor('new')} /></View>}>
    <View testID="swipe-week-calendar" {...calendarSwipe.panHandlers} style={[s.card, { padding: 4, gap: 2 }]}>
      <View style={[s.between, { gap: 4 }]}><IconButton name="chevron-left" label="Previous week" onPress={() => { setWeek(w => w - 1); setDate(null); }} /><Text style={s.muted}>{format(first, 'MMM d')} – {format(days[6], 'MMM d')}</Text><IconButton name="chevron-right" label="Next week" onPress={() => { setWeek(w => w + 1); setDate(null); }} /></View>
      <View style={{ flexDirection: 'row' }}>{days.map(day => {
        const key = format(day, 'yyyy-MM-dd'); const count = open.filter(i => i.dueAt && dayOf(i.dueAt) === key).length;
        return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${format(day, 'EEEE, MMMM d')}, ${count} open tasks`} accessibilityState={{ selected: date === key }} onPress={() => { setDate(date === key ? null : key); setStatus('open'); if (filter === 'unscheduled') setFilter('all'); }} style={{ flex: 1, paddingVertical: 6, alignItems: 'center', gap: 3, backgroundColor: date === key ? c.secondary : 'transparent', borderRadius: 8 }}><Text style={[s.muted, { fontSize: 10 }]}>{format(day, 'EEEEE')}</Text><Copy style={{ color: key === todayKey ? c.accent : c.foreground }}>{format(day, 'd')}</Copy><Text style={[s.muted, { fontSize: 10 }]}>{count || '·'}</Text></Pressable>;
      })}</View>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1, flexShrink: 1, minWidth: 0 }}>{(['all', 'scheduled', 'unscheduled'] as const).map(kind => <Pressable key={kind} testID={`filter-${kind}`} accessibilityRole="button" accessibilityState={{ selected: filter === kind }} onPress={() => { setFilter(kind); if (kind === 'unscheduled') setDate(null); }} style={{ minHeight: 44, paddingHorizontal: 5, justifyContent: 'center', flexShrink: 1 }}><Text numberOfLines={1} style={[s.muted, { fontSize: 11, lineHeight: 22, textTransform: 'capitalize', color: filter === kind ? c.foreground : c.mutedForeground, fontFamily: filter === kind ? 'Geist_500Medium' : 'Geist_400Regular', borderBottomWidth: 2, borderBottomColor: filter === kind ? c.accent : 'transparent' }]}>{kind}</Text></Pressable>)}</View>
      <StatusDropdown value={status} onChange={setStatus} />
    </View>
    <Text style={[s.muted, { fontSize: 11 }]}>{date ? `${format(new Date(`${date}T12:00:00`), 'EEE, MMM d')} · ` : ''}{visible.length} {status} {visible.length === 1 ? 'task' : 'tasks'}</Text>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {q.isLoading ? <Skeleton /> : q.isError ? <Failure error={q.error} retry={() => void q.refetch()} /> : !visible.length ? <Empty title={status === 'open' ? 'A little breathing room.' : 'Nothing here yet.'} text={date ? 'No tasks scheduled for this day.' : status === 'open' ? 'Speak to your ring, or add a task.' : `Your ${status} tasks will appear here.`} icon="check-circle" /> :
      <View style={[s.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>{visible.map((item, i) => <SwipeTaskRow key={item.id} id={item.id} disabled={pendingIds.has(item.id) || update.isPending} allowPendingPin={pendingPins.current.has(item.id)} onPin={() => void taskAction(item, 'pin')} onDelete={() => void taskAction(item, 'delete')}>{guard => <View style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
        {!!item.pinnedAt && <Pressable accessibilityRole="button" accessibilityLabel={`Unpin ${item.title}`} disabled={pendingIds.has(item.id)} onPress={() => guard(() => void taskAction(item, 'unpin'))} style={{ minHeight: 44, paddingLeft: 51, flexDirection: 'row', alignItems: 'center', gap: 5 }}><Feather name="map-pin" size={12} color={c.accent} /><Text style={[s.muted, { color: c.accent }]}>Pinned</Text></Pressable>}
        {item.sourceDeleted && <Text style={[s.muted, { paddingLeft: 51 }]}>Original content deleted</Text>}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
          <IconButton name={item.status === 'completed' ? 'check-circle' : item.status === 'dismissed' ? 'rotate-ccw' : 'circle'} label={`${item.status === 'open' ? 'Complete' : 'Reopen'} ${item.title}`} disabled={update.isPending || pendingIds.has(item.id)} onPress={() => guard(() => patch(item, { status: item.status === 'open' ? 'completed' : 'open' }))} color={item.status === 'completed' ? c.success : c.mutedForeground} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} style={{ flex: 1, paddingTop: 9, gap: 6 }} onPress={() => guard(() => openEditor(item))}><Copy style={{ fontSize: 16, lineHeight: 25, textDecorationLine: item.status !== 'open' ? 'line-through' : 'none', color: item.status !== 'open' ? c.mutedForeground : c.foreground }}>{item.title}</Copy><Text style={[s.muted, { color: item.dueAt && item.status === 'open' && new Date(item.dueAt).getTime() < Date.now() ? c.accent : c.mutedForeground }]}>{item.dueAt ? `${new Date(item.dueAt).getTime() < Date.now() && item.status === 'open' ? 'Overdue · ' : ''}${formatInTimeZone(item.dueAt, tz, 'MMM d · h:mm a')}` : 'No date'}</Text>{item.needsReview && <Text style={{ ...s.muted, color: c.accent }}>Check time{item.originalTimeText ? `: “${item.originalTimeText}”` : ''}</Text>}</Pressable>
          <IconButton name="more-horizontal" label={`Actions for ${item.title}`} onPress={() => guard(() => { setError(''); setMenu(item); })} />
        </View>
      </View>}</SwipeTaskRow>)}</View>}
    <Text style={s.muted}>{tz.replaceAll('_', ' ')}</Text>
    {editor && <ItemEditor item={editor === 'new' ? undefined : editor} tasks={editorTasks} tz={tz} onClose={() => setEditor(null)} />}
    {!!menu && <Sheet visible title="Task actions" onClose={() => setMenu(null)}><View pointerEvents={pendingIds.has(menu.id) ? 'none' : 'auto'} style={{ gap: 12 }}>
      <Copy>{menu.title}</Copy>
      <Button label={menu.pinnedAt ? 'Repin task' : 'Pin task'} quiet disabled={pendingIds.has(menu.id) || update.isPending} onPress={() => void taskAction(menu, 'pin')} />
      {!!menu.pinnedAt && <Button label="Unpin task" quiet disabled={pendingIds.has(menu.id) || update.isPending} onPress={() => void taskAction(menu, 'unpin')} />}
      <Button label="Edit task" quiet onPress={() => { openEditor(menu); setMenu(null); }} />
      {menu.sourceDeleted ? <Text style={s.muted}>Original content deleted</Text> : <Button label="Original message" quiet onPress={() => { router.navigate({ pathname: '/inbox', params: { focus: menu.sourceEventId } }); setMenu(null); }} />}
      <Button label={menu.status === 'dismissed' ? 'Restore task' : 'Dismiss task'} quiet disabled={update.isPending} onPress={() => menu.status === 'dismissed' ? patch(menu, { status: 'open' }) : void taskAction(menu, 'delete')} />
      <Text style={s.muted}>Dismissed tasks can be restored from the Dismissed filter.</Text>
      <Button label="Make a note" quiet onPress={() => { setConfirm({ item: menu, kind: 'note' }); setMenu(null); }} />
      <Button label="Delete task" danger disabled={pendingIds.has(menu.id) || update.isPending} onPress={() => { setConfirm({ item: menu, kind: 'delete' }); setMenu(null); }} />
      {!!error && <Text style={s.error}>{error}</Text>}
    </View></Sheet>}
    {!!confirm && <Confirm title={confirm.kind === 'note' ? 'Make a note' : 'Delete task'} message="Remove only this task. The original message, audio, and other tasks remain unchanged. Undo is available for 15 seconds." pending={update.isPending || undo.deleting} error={error || undefined} onClose={() => { setConfirm(null); setError(''); }} onConfirm={() => void removeTask(confirm.item)} />}
  </Page><TaskUndoMessages undo={undo} /></View>;
}
