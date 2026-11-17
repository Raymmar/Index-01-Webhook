import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Code2, MoreVertical, Trash2 } from "lucide-react";
import { useGetOrganizer, getGetOrganizerQueryKey, useUnderstandEvent, type InboxEvent, type ActionItem, type ProcessingJob } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { prioritizeEvents } from "@/lib/feed-order";
import { useInboxFeed } from "@/hooks/use-inbox-feed";
import { useToast } from "@/hooks/use-toast";
import { FeedScrollAnchor } from "@/components/feed-scroll-anchor";
import { ActionItemRow } from "./items";
import { SwipeDelete } from "@/components/swipe-delete";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useDeleteEvent, getListEventsQueryKey, getGetEventQueryKey, type EventPage } from "@workspace/api-client-react";

function ts(s: string) { return format(new Date(s), "MMM d, h:mm a"); }
function size(n: number) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`; }
const EMPTY_ITEMS: ActionItem[] = [];
const skipMessageDeleteKey = "index:skip-message-delete-confirmation";

function Organize({ e, items, job, pending, error, onOrganize }: { e: InboxEvent; items: ActionItem[]; job?: ProcessingJob; pending: boolean; error: boolean; onOrganize: () => void }) {
  const busy = pending || job?.status === "pending" || job?.status === "processing";
  const btn = "rounded px-1.5 py-0.5 text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
  if (busy) return <span role="status" className="flex items-center gap-1.5" data-testid={`status-organizing-${e.id}`}><span className="ri-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{job?.status === "processing" ? "Processing with AI" : "Queued"}</span>;
  if (job?.status === "failed" || error) {
    return <span className="flex max-w-56 flex-wrap items-center gap-1 break-words text-destructive" data-testid={`status-failed-${e.id}`}><span>{job?.error ?? "Could not start processing. Retry this note."}</span><button type="button" className={btn} data-testid={`button-retry-organize-${e.id}`} onClick={onOrganize}>Retry</button></span>;
  }
  if (!e.transcription) return null;
  if (items.length) {
    return (
      <span data-testid={`text-extracted-${e.id}`}>{items.length} {items.length === 1 ? "task" : "tasks"}</span>
    );
  }
  if (job?.status === "completed") return <span data-testid={`text-extracted-${e.id}`}>Note</span>;
  return <button type="button" className={btn} data-testid={`button-organize-${e.id}`} onClick={onOrganize}>Organize</button>;
}

export const EventCard = memo(function EventCard({ e, items, job, highlight, embedded, localPending }: { e: InboxEvent; items: ActionItem[]; job?: ProcessingJob; highlight: boolean; embedded: boolean; localPending: boolean }) {
  const qc = useQueryClient();
  const deletion = useDeleteEvent();
  const { toast } = useToast();
  const [skipDelete, setSkipDelete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleting = useRef(false);
  function requestDelete() {
    if (deleting.current) return;
    deletion.reset();
    setSkipDelete(false);
    try {
      if (localStorage.getItem(skipMessageDeleteKey) === "true") {
        void remove().catch(() => setConfirmDelete(true));
        return;
      }
    } catch {
      // Keep confirmation when browser storage is unavailable.
    }
    setConfirmDelete(true);
  }
  async function remove() {
    if (deleting.current) return;
    deleting.current = true;
    try {
    await deletion.mutateAsync({ id: e.id });
    setConfirmDelete(false);
    await qc.cancelQueries({ queryKey: getListEventsQueryKey() });
    qc.setQueriesData<EventPage>({ queryKey: getListEventsQueryKey() }, previous => previous && ({ ...previous, items: previous.items.filter(item => item.id !== e.id) }));
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListEventsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetEventQueryKey(e.id) }),
    ]);
    } finally { deleting.current = false; }
  }
  const understand = useUnderstandEvent({ mutation: { onSettled: () => qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }) } });
  const pending = understand.isPending || localPending;
  const busy = pending || job?.status === "pending" || job?.status === "processing";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [highlight]);
  return (
    <SwipeDelete disabled={deletion.isPending || confirmDelete} onDelete={async () => requestDelete()}><article ref={ref} tabIndex={-1} data-event-id={e.id} id={`${embedded ? "incoming" : "event"}-${e.id}`} className={`min-w-0 rounded-lg border p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${busy ? "bg-accent/5" : "bg-card"} ${highlight ? "border-accent" : "border-border"}`} data-testid={`card-event-${e.id}`}>
      <div className="flex items-start gap-2"><div className="min-w-0 flex-1">
      {e.transcription ? <p className="app-content-text whitespace-pre-wrap break-words" data-testid={`text-transcription-${e.id}`}>{e.transcription}</p> : <p className="text-sm text-muted-foreground">{e.kind === "recording" ? "Transcript unavailable" : "Webhook event received"}</p>}
      </div><DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Message actions" data-testid={`button-message-actions-${e.id}`} disabled={deletion.isPending} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"><MoreVertical className="h-4 w-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={requestDelete} data-testid={`button-delete-message-${e.id}`}><Trash2 className="mr-2 h-4 w-4" />Delete message</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      {e.audioUrl && (
        <div className="mt-2">
          <audio controls preload="none" src={e.audioUrl} onPlay={event => {
            const playing = event.currentTarget;
            playing.ownerDocument.querySelectorAll("audio").forEach(audio => {
              if (audio !== playing) audio.pause();
            });
          }} className="h-8 w-full" data-testid={`audio-${e.id}`} />
        </div>
      )}
      {items.length > 0 && <ul className="mt-2 divide-y divide-border border-t border-border" aria-label="Linked tasks">
        {items.map(item => <ActionItemRow key={item.id} item={item} tz={item.timezone} />)}
      </ul>}
      <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-1 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="max-w-40 truncate" title={e.webhookName}>{e.webhookName}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={e.recordedAt || e.receivedAt} title={`${e.recordedAt ? "Recorded" : "Received"} ${format(new Date(e.recordedAt || e.receivedAt), "PPpp")}`} data-testid={`text-received-${e.id}`}>{ts(e.recordedAt || e.receivedAt)}</time>
          {e.audioSize != null && <><span aria-hidden="true">·</span><span>{size(e.audioSize)}</span></>}
        </div>
        <div className="ml-auto flex min-w-0 items-center"><Organize e={e} items={items} job={job} pending={pending} error={understand.isError} onOrganize={() => understand.mutate({ id: e.id })} /></div>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? "Hide payload" : "Show payload"} title={open ? "Hide payload" : "Show payload"} aria-expanded={open} aria-controls={`${embedded ? "incoming-" : ""}payload-${e.id}`} data-testid={`button-payload-${e.id}`} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${open ? "bg-secondary text-foreground" : ""}`}>
          <Code2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </footer>
      <pre id={`${embedded ? "incoming-" : ""}payload-${e.id}`} hidden={!open} aria-label="Event payload" className="mt-2 max-h-80 overflow-auto rounded-md bg-primary p-3 font-mono text-[12px] leading-relaxed text-primary-foreground">{open ? JSON.stringify(e.payload, null, 2) : null}</pre>
      <AlertDialog open={confirmDelete} onOpenChange={value => { if (!deleting.current) setConfirmDelete(value); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>The original message and audio will be hidden. Tasks and other objects created from it will remain, with a notice that the original content was deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={skipDelete} disabled={deletion.isPending}
              onChange={event => setSkipDelete(event.target.checked)}
              data-testid="checkbox-skip-message-delete-confirmation" className="h-4 w-4 accent-primary" />
            Don't show this again
          </label>
          {deletion.isError && <p role="alert" className="text-sm text-destructive">Could not delete. Your message is still here. Try again.</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletion.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deletion.isPending} className="bg-destructive text-destructive-foreground" onClick={event => {
              event.preventDefault();
              if (skipDelete) {
                try { localStorage.setItem(skipMessageDeleteKey, "true"); }
                catch { toast({ description: "Your browser couldn't remember this preference." }); }
              }
              void remove().catch(() => {});
            }}>{deletion.isPending ? "Deleting…" : "Delete message"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article></SwipeDelete>
  );
}, (previous, next) =>
  previous.e === next.e && previous.job === next.job &&
  previous.highlight === next.highlight && previous.embedded === next.embedded &&
  previous.localPending === next.localPending &&
  previous.items.length === next.items.length &&
  previous.items.every((item, index) => item === next.items[index]));

/** The signed-in shell embeds the same feed and cards as the full Inbox route. */
export function InboxFeed({ embedded = false, selectedNote = null }: { embedded?: boolean; selectedNote?: string | null }) {
  const q = useInboxFeed();
  const organizer = useGetOrganizer({ query: { queryKey: getGetOrganizerQueryKey() } });
  const search = useSearch();
  const target = embedded ? selectedNote : new URLSearchParams(search).get("event");
  const { loadingMore, moreErr, loadMore } = q;
  const feedRoot = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const nextCursor = q.data?.nextCursor;
  const all = q.data?.items ?? [];
  const byEvent = useMemo(() => {
    const m = new Map<string, ActionItem[]>();
    for (const i of organizer.data?.items ?? []) if (i.sourceEventId) {
      const group = m.get(i.sourceEventId);
      if (group) group.push(i);
      else m.set(i.sourceEventId, [i]);
    }
    return m;
  }, [organizer.data?.items]);
  const jobs = useMemo(() => new Map((organizer.data?.jobs ?? []).map((j) => [j.eventId, j])), [organizer.data?.jobs]);
  const pendingIds = useMutationState({
    filters: { mutationKey: ["understandEvent"], status: "pending" },
    select: mutation => (mutation.state.variables as { id: string } | undefined)?.id,
  });
  const localPending = useMemo(() => new Set(pendingIds.filter((id): id is string => !!id)), [pendingIds]);
  const displayed = useMemo(() => embedded ? prioritizeEvents(all, [...jobs.values()], localPending) : all, [embedded, all, jobs, localPending]);
  const found = !target || all.some((e) => e.id === target);
  const searching = !!target && !found && !!nextCursor && !moreErr && !q.isLoading && !q.isError;

  const loadRef = useRef(loadMore);
  loadRef.current = loadMore;
  useEffect(() => { if (searching && !loadingMore) void loadRef.current(); }, [searching, loadingMore, all.length]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !nextCursor || loadingMore || moreErr || q.isError || typeof IntersectionObserver === "undefined") return;
    const root = embedded ? feedRoot.current?.closest<HTMLElement>("[data-inbox-scroll]") ?? null : null;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (active && entries.some(entry => entry.isIntersecting)) void loadRef.current();
    }, { root, rootMargin: "0px 0px 240px 0px" });
    observer.observe(element);
    return () => { active = false; observer.disconnect(); };
  }, [embedded, nextCursor, loadingMore, moreErr, q.isError, all.length]);

  return (
    <div ref={feedRoot}>
      {target && !found && !nextCursor && !q.isLoading && !q.isError && <p className="mb-3 text-sm text-muted-foreground" data-testid="text-source-missing">That note is no longer in the inbox.</p>}
      {searching && <p role="status" className="mb-3 text-sm text-muted-foreground">Looking for the linked note…</p>}
      {q.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : q.isError && !q.data ? (
        <div className="rounded-lg border border-destructive/40 p-5 text-sm">
          Could not load events. <button className="underline" data-testid="button-retry" onClick={() => q.refetch()}>Retry</button>
        </div>
      ) : all.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <div className="mx-auto h-10 w-10 rounded-full border-4 border-muted-foreground/30" />
          <p className="mt-4 font-display text-2xl">Nothing has arrived yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Create a webhook, paste it into the ring app, then press Send test event.</p>
          <Link href="/webhooks" data-testid="link-setup" className="mt-5 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Set up a webhook</Link>
        </div>
      ) : (
        <FeedScrollAnchor embedded={embedded} target={target} events={all}>
        <div className="space-y-3" aria-busy={loadingMore}>
          {displayed.map((e) => <EventCard key={e.id} e={e} items={byEvent.get(e.id) ?? EMPTY_ITEMS} job={jobs.get(e.id)} highlight={e.id === target} embedded={embedded} localPending={localPending.has(e.id)} />)}
          <div ref={sentinel} aria-hidden="true" className="h-px" data-testid="inbox-bottom-sentinel" />
          <div role="status" aria-live="polite" className="text-center text-xs text-muted-foreground">
            {loadingMore ? "Loading older messages…" : moreErr ? "Could not load older messages. Retry below." : !nextCursor ? "You’ve reached the beginning of your messages." : ""}
          </div>
          <button type="button" onClick={() => void loadMore(true)} aria-disabled={loadingMore || !nextCursor} tabIndex={nextCursor ? 0 : -1} data-testid="button-load-more" className="w-full rounded-md border border-border py-2 text-sm text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50">
            {loadingMore ? "Loading…" : moreErr ? "Retry loading older messages" : nextCursor ? "Load older messages" : "All messages loaded"}
          </button>
          {q.isError && <p role="alert" className="text-sm text-destructive">Could not refresh messages. <button type="button" className="underline" onClick={() => q.refetch()}>Retry refresh</button></p>}
        </div>
        </FeedScrollAnchor>
      )}
    </div>
  );
}

export default function Inbox() {
  return <InboxFeed />;
}
