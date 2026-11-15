import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Code2 } from "lucide-react";
import { useListEvents, getListEventsQueryKey, listEvents, useGetOrganizer, getGetOrganizerQueryKey, useUnderstandEvent, type InboxEvent, type ActionItem, type ProcessingJob } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { mergeEvents, prioritizeEvents } from "@/lib/feed-order";

function ts(s: string) { return format(new Date(s), "MMM d, h:mm a"); }
function size(n: number) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`; }

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
      <span className="flex items-center gap-2" data-testid={`text-extracted-${e.id}`}>
        <Link href={items[0]?.dueAt ? "/dashboard?schedule=scheduled" : "/dashboard?schedule=unscheduled"} className="hover:text-foreground">{items[0]?.dueAt ? "Scheduled task" : "Task"}</Link>
        {items[0]?.status !== "open" && <span>{items[0]?.status === "completed" ? "Completed" : "Dismissed"}</span>}
      </span>
    );
  }
  if (job?.status === "completed") return <span data-testid={`text-extracted-${e.id}`}>Note</span>;
  return <button type="button" className={btn} data-testid={`button-organize-${e.id}`} onClick={onOrganize}>Organize</button>;
}

export function EventCard({ e, items, job, highlight, embedded, localPending }: { e: InboxEvent; items: ActionItem[]; job?: ProcessingJob; highlight: boolean; embedded: boolean; localPending: boolean }) {
  const qc = useQueryClient();
  const understand = useUnderstandEvent({ mutation: { onSettled: () => qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }) } });
  const pending = understand.isPending || localPending;
  const busy = pending || job?.status === "pending" || job?.status === "processing";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [highlight]);
  return (
    <article ref={ref} id={`${embedded ? "incoming" : "event"}-${e.id}`} className={`ri-in min-w-0 rounded-lg border p-3 ${busy ? "bg-accent/5" : "bg-card"} ${highlight ? "border-accent" : "border-border"}`} data-testid={`card-event-${e.id}`}>
      {e.transcription ? <p className="app-content-text whitespace-pre-wrap break-words" data-testid={`text-transcription-${e.id}`}>{e.transcription}</p> : <p className="text-sm text-muted-foreground">{e.kind === "recording" ? "Transcript unavailable" : "Webhook event received"}</p>}
      {e.audioUrl && (
        <div className="mt-2">
          <audio controls preload="none" src={e.audioUrl} className="h-8 w-full" data-testid={`audio-${e.id}`} />
        </div>
      )}
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
      <pre id={`${embedded ? "incoming-" : ""}payload-${e.id}`} hidden={!open} aria-label="Event payload" className="mt-2 max-h-80 overflow-auto rounded-md bg-primary p-3 font-mono text-[12px] leading-relaxed text-primary-foreground">{JSON.stringify(e.payload, null, 2)}</pre>
    </article>
  );
}

/** The signed-in shell embeds the same feed and cards as the full Inbox route. */
export function InboxFeed({ embedded = false, selectedNote = null }: { embedded?: boolean; selectedNote?: string | null }) {
  const q = useListEvents(undefined, { query: { queryKey: getListEventsQueryKey() } });
  const organizer = useGetOrganizer({ query: { queryKey: getGetOrganizerQueryKey() } });
  const search = useSearch();
  const target = embedded ? selectedNote : new URLSearchParams(search).get("event");
  const [older, setOlder] = useState<InboxEvent[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreErr, setMoreErr] = useState(false);
  const feedRoot = useRef<HTMLDivElement>(null);
  // Retain every page already shown, including previous heads. An SSE refresh
  // can shift a note off the first page without removing it from the visible feed.
  useEffect(() => {
    if (q.data) setOlder(previous => mergeEvents(previous, q.data.items));
  }, [q.data]);
  const head = q.data?.items;
  const nextCursor = cursor === undefined ? q.data?.nextCursor : cursor;
  const all = useMemo(() => mergeEvents(older, head ?? []), [older, head]);
  const byEvent = useMemo(() => {
    const m = new Map<string, ActionItem[]>();
    for (const i of organizer.data?.items ?? []) if (i.sourceEventId) m.set(i.sourceEventId, [...(m.get(i.sourceEventId) ?? []), i]);
    return m;
  }, [organizer.data]);
  const jobs = useMemo(() => new Map((organizer.data?.jobs ?? []).map((j) => [j.eventId, j])), [organizer.data]);
  const pendingIds = useMutationState({
    filters: { mutationKey: ["understandEvent"], status: "pending" },
    select: mutation => (mutation.state.variables as { id: string } | undefined)?.id,
  });
  const localPending = new Set(pendingIds.filter((id): id is string => !!id));
  const activeIds = [...jobs.values()].filter(job => job.status === "pending" || job.status === "processing").map(job => job.eventId);
  const missingActive = embedded && [...activeIds, ...localPending].some(id => !all.some(event => event.id === id));
  const displayed = embedded ? prioritizeEvents(all, [...jobs.values()], localPending) : all;
  const processingId = embedded && displayed[0] && jobs.get(displayed[0].id)?.status === "processing" ? displayed[0].id : null;
  useEffect(() => {
    if (processingId && !target) feedRoot.current?.parentElement?.scrollTo({ top: 0 });
  }, [processingId, target]);
  const found = !target || all.some((e) => e.id === target);
  const searching = ((!!target && !found) || missingActive) && !!nextCursor && !moreErr && !q.isLoading && !q.isError;

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true); setMoreErr(false);
    try { const p = await listEvents({ before: nextCursor }); setOlder((o) => mergeEvents(o, p.items)); setCursor(p.nextCursor); }
    catch { setMoreErr(true); } finally { setLoadingMore(false); }
  }

  const loadRef = useRef(loadMore);
  loadRef.current = loadMore;
  useEffect(() => { if (searching && !loadingMore) void loadRef.current(); }, [searching, loadingMore, all.length]);

  return (
    <div ref={feedRoot}>
      {target && !found && !searching && !q.isLoading && <p className="mb-3 text-sm text-muted-foreground" data-testid="text-source-missing">That note is no longer in the inbox.</p>}
      {q.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : q.isError ? (
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
        <div className="space-y-3">
          {displayed.map((e) => <EventCard key={e.id} e={e} items={byEvent.get(e.id) ?? []} job={jobs.get(e.id)} highlight={e.id === target} embedded={embedded} localPending={localPending.has(e.id)} />)}
          {nextCursor && (
            <button type="button" onClick={loadMore} disabled={loadingMore} data-testid="button-load-more" className="w-full rounded-md border border-border py-2 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50">
              {loadingMore ? "Loading..." : moreErr ? "Failed, try again" : "Load older events"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Inbox() {
  return <InboxFeed />;
}
