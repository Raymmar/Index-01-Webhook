import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateItem, useUpdateItem, useGetEvent, getGetOrganizerQueryKey, getListEventsQueryKey, type ActionItem } from '@workspace/api-client-react';
import { Sheet, Button, Field, IconButton, Copy, Failure, s, c, errorMessage } from './ui';
import { Recording } from './recording';

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

export function ItemEditor({ item, tz, onClose }: { item?: ActionItem; tz: string; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [due, setDue] = useState<Date | null>(item?.dueAt ? new Date(item.dueAt) : null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [webDate, setWebDate] = useState(item?.dueAt ? formatInTimeZone(item.dueAt, tz, "yyyy-MM-dd'T'HH:mm") : '');
  const [error, setError] = useState('');
  const create = useCreateItem();
  const update = useUpdateItem();
  const qc = useQueryClient();
  const busy = create.isPending || update.isPending;
  const save = () => {
    setError('');
    let dueAt = due?.toISOString() ?? null;
    if (Platform.OS === 'web') {
      if (webDate.trim()) {
        const instant = fromZonedTime(webDate.trim(), tz);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(webDate.trim()) || !Number.isFinite(instant.getTime()) || formatInTimeZone(instant, tz, "yyyy-MM-dd'T'HH:mm") !== webDate.trim()) { setError('Use YYYY-MM-DDTHH:mm. This time must exist in your timezone.'); return; }
        dueAt = instant.toISOString();
      } else dueAt = null;
    }
    const options = { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }); void qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); onClose(); }, onError: (e: unknown) => setError(errorMessage(e)) };
    if (item) update.mutate({ id: item.id, data: { title: title.trim(), dueAt, needsReview: false } }, options);
    else create.mutate({ data: { title: title.trim(), dueAt } }, options);
  };
  return <Sheet visible title={item ? 'Edit task' : 'New task'} onClose={() => { if (!busy) onClose(); }}>
    <Text style={s.label}>Task</Text><Field accessibilityLabel="Task title" placeholder="What needs doing?" value={title} onChangeText={setTitle} multiline maxLength={500} style={{ minHeight: 105, textAlignVertical: 'top', lineHeight: 26 }} />
    <Text style={s.label}>Due date</Text>
    {Platform.OS === 'web' ? <><Field accessibilityLabel="Due date in saved timezone" placeholder="YYYY-MM-DDTHH:mm" autoCapitalize="none" value={webDate} onChangeText={setWebDate} /><Text style={s.muted}>Browser preview uses typed dates. The iOS app uses the native date and time picker.</Text></> : <View style={s.card}>
      <View style={s.between}><Copy>{due ? formatInTimeZone(due, tz, 'EEE, MMM d · h:mm a') : 'No date'}</Copy>{due && <IconButton name="x" label="Clear date" onPress={() => { setDue(null); setPicker(null); }} />}</View>
      <View style={s.row}><Button label={due ? 'Change date' : 'Add date'} quiet onPress={() => { if (!due) setDue(new Date()); setPicker('date'); }} /><Button label="Set time" quiet onPress={() => { if (!due) setDue(new Date()); setPicker('time'); }} /></View>
      {picker && <DateTimePicker value={due ?? new Date()} mode={picker} display={Platform.OS === 'ios' ? 'spinner' : 'default'} timeZoneName={tz} themeVariant="light" textColor={c.foreground} accentColor={c.accent} onChange={(event, date) => { if (Platform.OS === 'android') setPicker(null); if (event.type !== 'dismissed' && date) setDue(date); }} />}
    </View>}
    <Text style={s.muted}>{tz.replaceAll('_', ' ')}</Text>{!!error && <Text style={s.error}>{error}</Text>}
    <Button label={busy ? 'Saving…' : item ? 'Save task' : 'Add task'} disabled={busy || !title.trim()} onPress={save} />
    {item && <TaskRecording eventId={item.sourceEventId} />}
  </Sheet>;
}
