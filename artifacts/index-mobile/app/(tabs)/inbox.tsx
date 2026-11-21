import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatInTimeZone } from 'date-fns-tz';
import { useQueryClient } from '@tanstack/react-query';
import { useGetOrganizer, useGetSettings, useUnderstandEvent, getGetOrganizerQueryKey, getListEventsQueryKey, type InboxEvent, type ProcessingJob } from '@workspace/api-client-react';
import { Copy, Skeleton, Failure, Empty, IconButton, Button, Sheet, s, c, errorMessage } from '@/components/ui';
import { Recording } from '@/components/recording';
import { useInboxPages, useLive, deviceZone } from '@/lib/session';
import { useDeleteEvent, getGetEventQueryKey } from '@workspace/api-client-react';
import { Confirm } from '@/components/ui';
import { useConfirmationPreferences } from '@workspace/api-client-react';
import { SwipeTaskRow } from '@/components/swipe-task-row';
import { LinkedTasks } from '@/components/linked-tasks';

function Message({ event, job, tz, focused = false, onDeleted }: { event: InboxEvent; job?: ProcessingJob; tz: string; focused?: boolean; onDeleted?: () => void }) {
  const [payload, setPayload] = useState(false);
  const [error, setError] = useState('');
  const retry = useUnderstandEvent();
  const qc = useQueryClient();
  const deletion = useDeleteEvent();
  const deleting = useRef(false);
  const [deleted, setDeleted] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmations = useConfirmationPreferences();
  function requestDelete() {
    setError(''); setMenu(false);
    if (confirmations.skips('skipMessageDeleteConfirmation')) void remove();
    else setConfirmDelete(true);
  }
  async function remove() {
    if (deleting.current) return;
    deleting.current = true; setError('');
    try {
      await deletion.mutateAsync({ id: event.id });
      setDeleted(true); setConfirmDelete(false); onDeleted?.();
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListEventsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetEventQueryKey(event.id) }),
      ]);
    } catch (e) { setError(errorMessage(e)); setConfirmDelete(true); }
    finally { deleting.current = false; }
  }
  const processing = job?.status === 'processing' || job?.status === 'pending';
  const label = job?.status === 'pending' ? 'Queued' : job?.status === 'processing' ? 'Processing' : job?.status === 'failed' ? 'Understanding failed' : event.kind === 'recording' ? 'Voice note' : 'Message';
  if (deleted) return null;
  return <><SwipeTaskRow id={`message-${event.id}`} pinEnabled={false} leftLabel="Delete" disabled={deletion.isPending || confirmDelete || !!event.deletedAt} onPin={() => {}} onDelete={requestDelete}>{guard => <View style={[s.card, { backgroundColor: processing ? c.processing : c.card, borderColor: focused ? c.accent : c.border, gap: 16 }]}>
    <View style={s.between}><View style={[s.row, { gap: 7 }]}>{processing && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c.accent }} />}<Text style={[s.label, { color: processing ? c.accent : job?.status === 'failed' ? c.destructive : c.mutedForeground }]}>{label}</Text></View><Text style={[s.muted, { fontSize: 10 }]}>{formatInTimeZone(event.recordedAt ?? event.receivedAt, tz, 'MMM d · h:mm a')}</Text></View>
    {event.deletedAt ? <Copy>Original content deleted</Copy> : event.transcription ? <Copy selectable style={{ fontSize: 16, lineHeight: 26 }}>{event.transcription}</Copy> : <Text style={s.muted}>{event.kind === 'recording' ? 'No transcript was included.' : 'JSON event received.'}</Text>}
    {!!event.audioUrl && <View onTouchStart={e => e.stopPropagation()}><Recording url={event.audioUrl} /></View>}
    <LinkedTasks eventId={event.id} tz={tz} />
    {job?.status === 'failed' && <View style={{ gap: 9 }}><Text style={s.error}>{job.error || 'This message could not be understood.'}</Text><Button label={retry.isPending ? 'Retrying…' : 'Try understanding again'} quiet disabled={retry.isPending} onPress={() => { setError(''); retry.mutate({ id: event.id }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }); void qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); }, onError: e => setError(errorMessage(e)) }); }} />{!!error && <Text style={s.error}>{error}</Text>}</View>}
    <View style={s.between}>
      <View style={[s.row, { flex: 1, minWidth: 0, gap: 6 }]}>
        {!event.deletedAt && <IconButton name="more-vertical" label="Message actions" onPress={() => guard(() => setMenu(true))} />}
        <Text style={[s.muted, { flex: 1, fontSize: 10 }]} numberOfLines={1}>{event.webhookName}{event.audioSize != null ? ` · ${Math.round(event.audioSize / 1024)} KB` : ''}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: payload }} onPress={() => guard(() => setPayload(v => !v))} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={s.muted}>{payload ? 'Hide payload −' : 'Payload +'}</Text></Pressable>
    </View>
    {payload && <View style={{ backgroundColor: c.secondary, padding: 12, borderRadius: 6 }}><Text selectable style={{ color: c.foreground, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, lineHeight: 18 }}>{JSON.stringify(event.payload, null, 2)}</Text><Text style={[s.muted, { marginTop: 12, fontSize: 10 }]}>Received {formatInTimeZone(event.receivedAt, tz, 'PPpp')} · {event.id}</Text></View>}
  </View>}</SwipeTaskRow>
    {menu && <Sheet visible title="Message actions" onClose={() => setMenu(false)}><Button label="Delete message" danger onPress={requestDelete} /></Sheet>}
    {confirmDelete && <Confirm preference="skipMessageDeleteConfirmation" title="Delete message" message="The original message and audio will be hidden. Linked tasks remain and will show that the original content was deleted." pending={deletion.isPending} error={error || undefined} onClose={() => setConfirmDelete(false)} onConfirm={remove} />}
  </>;
}

export default function Inbox() {
  const q = useInboxPages();
  const organizer = useGetOrganizer();
  const settings = useGetSettings();
  const tz = settings.data?.timezone ?? deviceZone();
  const live = useLive();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ focus?: string }>();
  const focus = typeof params.focus === 'string' ? params.focus : undefined;
  const [selected, setSelected] = useState<InboxEvent | null>(null);
  const [focusState, setFocusState] = useState('');
  const focusedFor = useRef<string | null>(null);
  const jobs = organizer.data?.jobs;
  const jobMap = useMemo(() => new Map((jobs ?? []).map(job => [job.eventId, job])), [jobs]);
  const events = useMemo(() => {
    const unique = new Map<string, InboxEvent>();
    for (const page of q.data?.pages ?? []) for (const event of page.items) unique.set(event.id, event);
    return [...unique.values()].sort((a, b) => {
      const active = (id: string) => ['pending', 'processing'].includes(jobMap.get(id)?.status ?? '') ? 1 : 0;
      return active(b.id) - active(a.id) || b.receivedAt.localeCompare(a.receivedAt);
    });
  }, [q.data, jobMap]);
  const eventIds = useMemo(() => new Set(events.map(e => e.id)), [events]);
  const unloadedJobs = (jobs ?? []).filter(j => (j.status === 'pending' || j.status === 'processing') && !eventIds.has(j.eventId));
  const fetchRef = useRef(q.fetchNextPage); fetchRef.current = q.fetchNextPage;
  useEffect(() => {
    if (!focus) { focusedFor.current = null; return; }
    if (focusedFor.current === focus || q.isLoading || q.isFetchingNextPage) return;
    const found = events.find(e => e.id === focus);
    if (found) { focusedFor.current = focus; setSelected(found); setFocusState(''); }
    else if (q.isError || q.isFetchNextPageError) setFocusState('Could not load the original message.');
    else if (q.hasNextPage) { setFocusState('Finding the original message…'); void fetchRef.current(); }
    else { focusedFor.current = focus; setFocusState('This original message could not be found.'); }
  }, [focus, events, q.hasNextPage, q.isLoading, q.isFetchingNextPage, q.isError, q.isFetchNextPageError]);
  const close = () => { setSelected(null); router.setParams({ focus: undefined }); };
  return <View style={s.screen}><FlatList data={events} keyExtractor={event => event.id} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={[s.content, { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 18, paddingBottom: 110 + insets.bottom, gap: 14 }]} keyboardDismissMode="on-drag" refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} tintColor={c.accent} onRefresh={() => { void q.refetch(); void organizer.refetch(); }} />} ListHeaderComponent={<View style={{ gap: 20, marginBottom: 8 }}>
    <Text style={s.label}>Index 0.1 / Originals</Text><View style={s.between}><Text style={s.heading}>Inbox</Text><IconButton name="refresh-cw" label="Refresh inbox" onPress={() => { void q.refetch(); void organizer.refetch(); }} /></View>
    <View style={s.between}><Text style={s.muted}>{organizer.data?.messageCount ?? '—'} messages</Text><View style={[s.row, { gap: 6 }]}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: live === 'live' ? c.accent : c.mutedForeground }} /><Text style={s.muted}>{live === 'live' ? 'Live' : live === 'paused' ? 'Paused' : 'Reconnecting'}</Text></View></View>
    {organizer.isError && <Failure error={organizer.error} retry={() => void organizer.refetch()} />}
    {q.isRefetchError && <Failure error={q.error} retry={() => void q.refetch()} />}
    {!!focusState && <View style={s.card}><Text style={s.muted}>{focusState}</Text>{(q.isError || q.isFetchNextPageError) && <Button label="Retry finding original" quiet onPress={() => { if (q.isFetchNextPageError) void q.fetchNextPage(); else void q.refetch(); }} />}</View>}
    {unloadedJobs.map(job => <View key={job.eventId} style={[s.card, { backgroundColor: c.processing }]}><Text style={[s.label, { color: c.accent }]}>{job.status === 'pending' ? 'Queued' : 'Processing'}</Text><Button label="View original" quiet onPress={() => router.setParams({ focus: job.eventId })} /></View>)}
  </View>} renderItem={({ item }) => <Message event={item} job={jobMap.get(item.id)} tz={tz} />} ListEmptyComponent={q.isLoading ? <Skeleton /> : q.isError ? <Failure error={q.error} retry={() => void q.refetch()} /> : <Empty title="The start of a thought." text="Messages and recordings from your ring appear here, unchanged." />} ListFooterComponent={<View style={{ gap: 12, paddingTop: 10 }}>{q.isFetchNextPageError ? <Failure error={q.error} retry={() => void q.fetchNextPage()} /> : q.isFetchingNextPage ? <Skeleton /> : q.hasNextPage ? <Button label="Load older messages" quiet onPress={() => void q.fetchNextPage()} /> : events.length ? <Text style={[s.muted, { textAlign: 'center' }]}>All messages loaded</Text> : null}</View>} />
    {selected && <Sheet visible title="Original message" onClose={close}><Message event={events.find(e => e.id === selected.id) ?? selected} job={jobMap.get(selected.id)} tz={tz} focused onDeleted={close} /></Sheet>}
  </View>;
}
