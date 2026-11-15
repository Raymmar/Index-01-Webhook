import { useRef, useState } from 'react';
import { Keyboard, Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateItem, useUpdateItem, useGetEvent, getGetOrganizerQueryKey, getListEventsQueryKey, type ActionItem } from '@workspace/api-client-react';
import { Sheet, Button, Field, IconButton, Copy, Failure, s, c, errorMessage } from './ui';
import { Recording } from './recording';
import { useHorizontalSwipe } from '@/hooks/use-horizontal-swipe';
import { TaskTitleField } from './task-title-field';

function TaskRecording({ eventId }: { eventId: string }) {
  const source = useGetEvent(eventId);
  if (source.isLoading) return <Text style={s.muted}>Loading original recording…</Text>;
  if (source.isError) return <Failure error={source.error} retry={() => void source.refetch()} />;
  if (!source.data?.audioUrl) return null;
  return <View style={{ gap: 10 }}>
    <Text style={s.label}>Original recording</Text>
    <Recording url={source.data.audioUrl} />
  </View>;
}

export function ItemEditor({ item: initialItem, tasks = [], tz, onClose }: { item?: ActionItem; tasks?: ActionItem[]; tz: string; onClose: () => void }) {
  const [item, setItem] = useState(initialItem);
  // Freeze the filtered ordering for this detail session, including saved edits.
  const [taskOrder] = useState(() => [...tasks]);
  const [savedTasks, setSavedTasks] = useState<Record<string, ActionItem>>({});
  const [pendingNavigation, setPendingNavigation] = useState<ActionItem | 'close' | null>(null);
  const saving = useRef(false);
  const titleFocused = useRef(false);
  const [title, setTitle] = useState(item?.title ?? '');
  const [due, setDue] = useState<Date | null>(item?.dueAt ? new Date(item.dueAt) : null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [webDate, setWebDate] = useState(item?.dueAt ? formatInTimeZone(item.dueAt, tz, "yyyy-MM-dd'T'HH:mm") : '');
  const [error, setError] = useState('');
  const create = useCreateItem();
  const update = useUpdateItem();
  const qc = useQueryClient();
  const busy = create.isPending || update.isPending;
  const index = taskOrder.findIndex(task => task.id === item?.id);
  const dirty = title !== (item?.title ?? '') || (Platform.OS === 'web'
    ? webDate !== (item?.dueAt ? formatInTimeZone(item.dueAt, tz, "yyyy-MM-dd'T'HH:mm") : '')
    : (due?.getTime() ?? null) !== (item?.dueAt ? new Date(item.dueAt).getTime() : null));
  function navigate(target: ActionItem | 'close') {
    Keyboard.dismiss();
    setPendingNavigation(null);
    if (target === 'close') { onClose(); return; }
    const next = savedTasks[target.id] ?? target;
    setItem(next);
    setTitle(next.title);
    setDue(next.dueAt ? new Date(next.dueAt) : null);
    setWebDate(next.dueAt ? formatInTimeZone(next.dueAt, tz, "yyyy-MM-dd'T'HH:mm") : '');
    setPicker(null);
    setError('');
  }
  function requestNavigation(target: ActionItem | 'close') {
    if (saving.current || busy || pendingNavigation) return;
    if (dirty) { Keyboard.dismiss(); setPendingNavigation(target); }
    else navigate(target);
  }
  function move(direction: 'next' | 'previous') {
    if (index < 0) return;
    const target = taskOrder[index + (direction === 'next' ? 1 : -1)];
    if (target) requestNavigation(target);
  }
  const swipe = useHorizontalSwipe(move, !!item && taskOrder.length > 1 && !busy && !pendingNavigation);
  const save = (destination?: ActionItem | 'close') => {
    if (saving.current || !title.trim()) return;
    setError('');
    let dueAt = due?.toISOString() ?? null;
    if (Platform.OS === 'web') {
      if (webDate.trim()) {
        const instant = fromZonedTime(webDate.trim(), tz);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(webDate.trim()) || !Number.isFinite(instant.getTime()) || formatInTimeZone(instant, tz, "yyyy-MM-dd'T'HH:mm") !== webDate.trim()) { setError('Use YYYY-MM-DDTHH:mm. This time must exist in your timezone.'); return; }
        dueAt = instant.toISOString();
      } else dueAt = null;
    }
    saving.current = true;
    const options = {
      onSuccess: () => {
        saving.current = false;
        void qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() });
        void qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
        if (item) setSavedTasks(previous => ({ ...previous, [item.id]: { ...item, title: title.trim(), dueAt, needsReview: false } }));
        if (destination) navigate(destination);
        else onClose();
      },
      onError: (e: unknown) => { saving.current = false; setError(errorMessage(e)); },
    };
    if (item) update.mutate({ id: item.id, data: { title: title.trim(), dueAt, needsReview: false } }, options);
    else create.mutate({ data: { title: title.trim(), dueAt } }, options);
  };
  return <Sheet visible title={item ? 'Edit task' : 'New task'} onClose={() => requestNavigation('close')} panHandlers={swipe.panHandlers}>
    {item && index >= 0 && taskOrder.length > 1 && <Text style={s.muted}>{index + 1} of {taskOrder.length}</Text>}
    {!!pendingNavigation && <View style={s.card} onTouchStart={swipe.blockSwipe}>
      <Copy>Save changes before {pendingNavigation === 'close' ? 'closing' : 'switching tasks'}?</Copy>
      <Button label={busy ? 'Saving…' : 'Save changes'} disabled={busy || !title.trim()} onPress={() => save(pendingNavigation)} />
      <Button label="Discard changes" quiet disabled={busy} onPress={() => navigate(pendingNavigation)} />
      <Button label="Keep editing" quiet disabled={busy} onPress={() => setPendingNavigation(null)} />
    </View>}
    <Text style={s.label}>Task</Text><View onTouchStart={() => { if (titleFocused.current) swipe.blockSwipe(); }}><TaskTitleField accessibilityLabel="Task title" placeholder="What needs doing?" value={title} onChangeText={setTitle} onFocus={() => { titleFocused.current = true; swipe.blockSwipe(); }} onBlur={() => { titleFocused.current = false; }} editable={!busy && !pendingNavigation} maxLength={500} /></View>
    <Text style={s.label}>Due date</Text>
    <View pointerEvents={busy || pendingNavigation ? 'none' : 'auto'} style={{ gap: 12 }}>
    {Platform.OS === 'web' ? <><View onTouchStart={swipe.blockSwipe}><Field accessibilityLabel="Due date in saved timezone" placeholder="YYYY-MM-DDTHH:mm" autoCapitalize="none" value={webDate} onChangeText={setWebDate} /></View><Text style={s.muted}>Browser preview uses typed dates. The iOS app uses the native date and time picker.</Text></> : <View style={s.card}>
      <View style={s.between}><Copy>{due ? formatInTimeZone(due, tz, 'EEE, MMM d · h:mm a') : 'No date'}</Copy>{due && <IconButton name="x" label="Clear date" onPress={() => { setDue(null); setPicker(null); }} />}</View>
      <View style={s.row}><Button label={due ? 'Change date' : 'Add date'} quiet onPress={() => { if (!due) setDue(new Date()); setPicker('date'); }} /><Button label="Set time" quiet onPress={() => { if (!due) setDue(new Date()); setPicker('time'); }} /></View>
      {picker && <View onTouchStart={swipe.blockSwipe}><DateTimePicker value={due ?? new Date()} mode={picker} display={Platform.OS === 'ios' ? 'spinner' : 'default'} timeZoneName={tz} themeVariant="light" textColor={c.foreground} accentColor={c.accent} onChange={(event, date) => { if (Platform.OS === 'android') setPicker(null); if (event.type !== 'dismissed' && date) setDue(date); }} /></View>}
    </View>}
    </View>
    <Text style={s.muted}>{tz.replaceAll('_', ' ')}</Text>{!!error && <Text style={s.error}>{error}</Text>}
    <View onTouchStart={swipe.blockSwipe}><Button label={busy ? 'Saving…' : item ? 'Save task' : 'Add task'} disabled={busy || !!pendingNavigation || !title.trim()} onPress={() => save()} /></View>
    {item && <View onTouchStart={swipe.blockSwipe}><TaskRecording key={item.id} eventId={item.sourceEventId} /></View>}
  </Sheet>;
}
