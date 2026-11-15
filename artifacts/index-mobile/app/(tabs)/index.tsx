import { useRef, useState, type ElementRef } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { addDays, format, startOfWeek } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useGetOrganizer, useGetSettings, useUpdateItem, useDeleteItem, getGetOrganizerQueryKey, getListEventsQueryKey, type ActionItem, type ItemUpdate } from '@workspace/api-client-react';
import { Page, Copy, Skeleton, Failure, Empty, IconButton, Button, Confirm, Sheet, s, c, errorMessage } from '@/components/ui';
import { ItemEditor } from '@/components/item-editor';
import { deviceZone, useLive } from '@/lib/session';
import { useHorizontalSwipe } from '@/hooks/use-horizontal-swipe';

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
  const [confirm, setConfirm] = useState<{ item: ActionItem; kind: 'note' | 'dismiss' } | null>(null);
  const [error, setError] = useState('');
  const update = useUpdateItem();
  const del = useDeleteItem();
  const qc = useQueryClient();
  const invalidate = () => { void qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }); void qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); };
  function patch(item: ActionItem, data: ItemUpdate) {
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
  const visible = items.filter(i => i.status === status && (filter === 'all' || (filter === 'scheduled' ? !!i.dueAt : !i.dueAt)) && (!date || (!!i.dueAt && dayOf(i.dueAt) === date))).sort((a, b) => a.dueAt && b.dueAt ? a.dueAt.localeCompare(b.dueAt) || b.createdAt.localeCompare(a.createdAt) : a.dueAt ? -1 : b.dueAt ? 1 : b.createdAt.localeCompare(a.createdAt));
  function openEditor(item: ActionItem) {
    setEditorTasks([...visible]);
    setEditor(item);
  }
  function changeWeek(direction: 'next' | 'previous') {
    setWeek(w => w + (direction === 'next' ? 1 : -1));
    setDate(null);
  }
  const calendarSwipe = useHorizontalSwipe(changeWeek);
  return <Page compact title="Dashboard" action={<View style={[s.row, { gap: 4 }]}><View style={[s.row, { gap: 5 }]}><View style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: live === 'live' ? c.accent : c.mutedForeground }} /><Text style={[s.muted, { fontSize: 10 }]}>{live === 'live' ? 'Live' : live === 'paused' ? 'Paused' : 'Connecting'}</Text></View><IconButton name="plus" label="New task" onPress={() => setEditor('new')} /></View>}>
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
      <View style={[s.card, { padding: 0, gap: 0 }]}>{visible.map((item, i) => <View key={item.id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
          <IconButton name={item.status === 'completed' ? 'check-circle' : item.status === 'dismissed' ? 'rotate-ccw' : 'circle'} label={`${item.status === 'open' ? 'Complete' : 'Reopen'} ${item.title}`} disabled={update.isPending} onPress={() => patch(item, { status: item.status === 'open' ? 'completed' : 'open' })} color={item.status === 'completed' ? c.success : c.mutedForeground} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} style={{ flex: 1, paddingTop: 9, gap: 6 }} onPress={() => openEditor(item)}><Copy style={{ fontSize: 16, lineHeight: 25, textDecorationLine: item.status !== 'open' ? 'line-through' : 'none', color: item.status !== 'open' ? c.mutedForeground : c.foreground }}>{item.title}</Copy><Text style={[s.muted, { color: item.dueAt && item.status === 'open' && new Date(item.dueAt).getTime() < Date.now() ? c.accent : c.mutedForeground }]}>{item.dueAt ? `${new Date(item.dueAt).getTime() < Date.now() && item.status === 'open' ? 'Overdue · ' : ''}${formatInTimeZone(item.dueAt, tz, 'MMM d · h:mm a')}` : 'No date'}</Text>{item.needsReview && <Text style={{ ...s.muted, color: c.accent }}>Check time{item.originalTimeText ? `: “${item.originalTimeText}”` : ''}</Text>}</Pressable>
          <IconButton name="more-horizontal" label={`Actions for ${item.title}`} onPress={() => { setError(''); setMenu(item); }} />
        </View>
      </View>)}</View>}
    <Text style={s.muted}>{tz.replaceAll('_', ' ')}</Text>
    {editor && <ItemEditor item={editor === 'new' ? undefined : editor} tasks={editorTasks} tz={tz} onClose={() => setEditor(null)} />}
    {!!menu && <Sheet visible title="Task actions" onClose={() => setMenu(null)}><Copy>{menu.title}</Copy><Button label="Edit task" quiet onPress={() => { openEditor(menu); setMenu(null); }} /><Button label="Original message" quiet onPress={() => { router.navigate({ pathname: '/inbox', params: { focus: menu.sourceEventId } }); setMenu(null); }} /><Button label={menu.status === 'dismissed' ? 'Restore task' : 'Dismiss task'} quiet disabled={update.isPending} onPress={() => menu.status === 'dismissed' ? patch(menu, { status: 'open' }) : (setConfirm({ item: menu, kind: 'dismiss' }), setMenu(null))} /><Button label="Make a note" quiet onPress={() => { setConfirm({ item: menu, kind: 'note' }); setMenu(null); }} />{!!error && <Text style={s.error}>{error}</Text>}</Sheet>}
    {!!confirm && <Confirm title={confirm.kind === 'note' ? 'Make a note' : 'Dismiss task'} message={confirm.kind === 'note' ? 'Remove this task’s action and due date. The original message and audio remain in your inbox.' : 'Move this task out of your open list. You can restore it later.'} pending={update.isPending || del.isPending} error={error || undefined} onClose={() => { setConfirm(null); setError(''); }} onConfirm={() => confirm.kind === 'note' ? del.mutate({ id: confirm.item.id }, { onSuccess: () => { invalidate(); setConfirm(null); }, onError: e => setError(errorMessage(e)) }) : patch(confirm.item, { status: 'dismissed' })} />}
  </Page>;
}
