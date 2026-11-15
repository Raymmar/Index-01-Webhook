import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { addDays, format, startOfWeek } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useGetOrganizer, useGetSettings, useUpdateItem, useDeleteItem, getGetOrganizerQueryKey, getListEventsQueryKey, type ActionItem, type ItemUpdate } from '@workspace/api-client-react';
import { Page, Copy, Skeleton, Failure, Empty, IconButton, Button, Chips, Confirm, Sheet, s, c, errorMessage } from '@/components/ui';
import { ItemEditor } from '@/components/item-editor';
import { deviceZone, useLive } from '@/lib/session';

export default function Dashboard() {
  const q = useGetOrganizer();
  const settings = useGetSettings();
  const tz = settings.data?.timezone ?? deviceZone();
  const live = useLive();
  const [filter, setFilter] = useState<'all' | 'scheduled' | 'unscheduled'>('all');
  const [status, setStatus] = useState<'open' | 'completed' | 'dismissed'>('open');
  const [week, setWeek] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [editor, setEditor] = useState<ActionItem | 'new' | null>(null);
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
  const reset = () => { setWeek(0); setDate(null); setFilter('all'); setStatus('open'); };
  return <Page title="Dashboard" eyebrow={`Index 0.1  /  ${format(today, 'EEE, MMM d')}`} action={<IconButton name="plus" label="New task" onPress={() => setEditor('new')} />}>
    <View style={{ backgroundColor: c.primary, borderRadius: 8, padding: 20, gap: 22 }}>
      <View style={s.between}><Text style={[s.label, { color: c.primaryForeground }]}>Your work, in view</Text><View style={[s.row, { gap: 6 }]}><View style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: live === 'live' ? c.accent : c.mutedForeground }} /><Text style={[s.muted, { color: c.primaryForeground, fontSize: 10 }]}>{live === 'live' ? 'Live' : live === 'paused' ? 'Paused' : 'Connecting'}</Text></View></View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}><Text style={[s.heading, { fontSize: 55, lineHeight: 60, color: c.primaryForeground }]}>{q.data ? open.length : '—'}</Text><Copy style={{ color: c.primaryForeground }}>open tasks</Copy></View>
      <View style={[s.between, { borderTopWidth: 1, borderTopColor: c.mutedForeground, paddingTop: 14 }]}><Pressable accessibilityRole="button" onPress={() => router.navigate('/inbox')}><Text style={[s.muted, { color: c.primaryForeground }]}>{q.data?.messageCount ?? '—'} messages <Feather name="arrow-up-right" size={12} /></Text></Pressable><Pressable accessibilityRole="button" onPress={() => { setFilter('scheduled'); setDate(null); setStatus('open'); }}><Text style={[s.muted, { color: c.primaryForeground }]}>{q.data ? open.filter(i => i.dueAt).length : '—'} scheduled</Text></Pressable></View>
    </View>
    <View style={s.between}><Text style={s.subheading}>Your week</Text><Pressable accessibilityRole="button" onPress={reset} style={{ paddingVertical: 10 }}><Text style={[s.muted, { color: c.accent }]}>All open items</Text></Pressable></View>
    <View style={[s.card, { padding: 8, gap: 2 }]}>
      <View style={s.between}><IconButton name="chevron-left" label="Previous week" onPress={() => { setWeek(w => w - 1); setDate(null); }} /><Text style={s.muted}>{format(first, 'MMM d')} – {format(days[6], 'MMM d, yyyy')}</Text><IconButton name="chevron-right" label="Next week" onPress={() => { setWeek(w => w + 1); setDate(null); }} /></View>
      <View style={{ flexDirection: 'row' }}>{days.map(day => {
        const key = format(day, 'yyyy-MM-dd'); const count = open.filter(i => i.dueAt && dayOf(i.dueAt) === key).length;
        return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${format(day, 'EEEE, MMMM d')}, ${count} open tasks`} accessibilityState={{ selected: date === key }} onPress={() => { setDate(date === key ? null : key); setStatus('open'); if (filter === 'unscheduled') setFilter('all'); }} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', gap: 9, backgroundColor: date === key ? c.secondary : 'transparent', borderRadius: 8 }}><Text style={[s.muted, { fontSize: 10 }]}>{format(day, 'EEEEE')}</Text><Copy style={{ color: key === todayKey ? c.accent : c.foreground }}>{format(day, 'd')}</Copy><Text style={[s.muted, { fontSize: 10 }]}>{count || '·'}</Text></Pressable>;
      })}</View>
    </View>
    <View style={{ gap: 8 }}><Chips values={['all', 'scheduled', 'unscheduled'] as const} value={filter} onChange={v => { setFilter(v); if (v === 'unscheduled') setDate(null); }} /><Chips values={['open', 'completed', 'dismissed'] as const} value={status} onChange={setStatus} /></View>
    <View style={s.between}><Text style={s.label}>{date ? format(new Date(`${date}T12:00:00`), 'EEEE, MMM d') : 'All dates'}</Text><Text style={s.muted}>{visible.length} items</Text></View>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {q.isLoading ? <Skeleton /> : q.isError ? <Failure error={q.error} retry={() => void q.refetch()} /> : !visible.length ? <Empty title={status === 'open' ? 'A little breathing room.' : 'Nothing here yet.'} text={date ? 'No tasks scheduled for this day.' : status === 'open' ? 'Speak to your ring, or add a task.' : `Your ${status} tasks will appear here.`} icon="check-circle" /> :
      <View style={[s.card, { padding: 0, gap: 0 }]}>{visible.map((item, i) => <View key={item.id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
          <IconButton name={item.status === 'completed' ? 'check-circle' : item.status === 'dismissed' ? 'rotate-ccw' : 'circle'} label={`${item.status === 'open' ? 'Complete' : 'Reopen'} ${item.title}`} disabled={update.isPending} onPress={() => patch(item, { status: item.status === 'open' ? 'completed' : 'open' })} color={item.status === 'completed' ? c.success : c.mutedForeground} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} style={{ flex: 1, paddingTop: 9, gap: 6 }} onPress={() => setEditor(item)}><Copy style={{ fontSize: 16, lineHeight: 25, textDecorationLine: item.status !== 'open' ? 'line-through' : 'none', color: item.status !== 'open' ? c.mutedForeground : c.foreground }}>{item.title}</Copy><Text style={[s.muted, { color: item.dueAt && item.status === 'open' && new Date(item.dueAt).getTime() < Date.now() ? c.accent : c.mutedForeground }]}>{item.dueAt ? `${new Date(item.dueAt).getTime() < Date.now() && item.status === 'open' ? 'Overdue · ' : ''}${formatInTimeZone(item.dueAt, tz, 'MMM d · h:mm a')}` : 'No date'}</Text>{item.needsReview && <Text style={{ ...s.muted, color: c.accent }}>Check time{item.originalTimeText ? `: “${item.originalTimeText}”` : ''}</Text>}</Pressable>
          <IconButton name="more-horizontal" label={`Actions for ${item.title}`} onPress={() => { setError(''); setMenu(item); }} />
        </View>
      </View>)}</View>}
    <Text style={s.muted}>{tz.replaceAll('_', ' ')}</Text>
    {editor && <ItemEditor item={editor === 'new' ? undefined : editor} tz={tz} onClose={() => setEditor(null)} />}
    {!!menu && <Sheet visible title="Task actions" onClose={() => setMenu(null)}><Copy>{menu.title}</Copy><Button label="Edit task" quiet onPress={() => { setEditor(menu); setMenu(null); }} /><Button label="Original message" quiet onPress={() => { router.navigate({ pathname: '/inbox', params: { focus: menu.sourceEventId } }); setMenu(null); }} /><Button label={menu.status === 'dismissed' ? 'Restore task' : 'Dismiss task'} quiet disabled={update.isPending} onPress={() => menu.status === 'dismissed' ? patch(menu, { status: 'open' }) : (setConfirm({ item: menu, kind: 'dismiss' }), setMenu(null))} /><Button label="Make a note" quiet onPress={() => { setConfirm({ item: menu, kind: 'note' }); setMenu(null); }} />{!!error && <Text style={s.error}>{error}</Text>}</Sheet>}
    {!!confirm && <Confirm title={confirm.kind === 'note' ? 'Make a note' : 'Dismiss task'} message={confirm.kind === 'note' ? 'Remove this task’s action and due date. The original message and audio remain in your inbox.' : 'Move this task out of your open list. You can restore it later.'} pending={update.isPending || del.isPending} error={error || undefined} onClose={() => { setConfirm(null); setError(''); }} onConfirm={() => confirm.kind === 'note' ? del.mutate({ id: confirm.item.id }, { onSuccess: () => { invalidate(); setConfirm(null); }, onError: e => setError(errorMessage(e)) }) : patch(confirm.item, { status: 'dismissed' })} />}
  </Page>;
}
