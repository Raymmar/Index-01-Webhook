import { useState } from "react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { useListEvents, getListEventsQueryKey, listEvents, type InboxEvent } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";

function ts(s: string) { const d = new Date(s); return `${format(d, "MMM d, HH:mm:ss")} · ${formatDistanceToNow(d, { addSuffix: true })}`; }
function size(n: number) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`; }

function EventCard({ e }: { e: InboxEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="ri-in rounded-lg border bg-card p-4" data-testid={`card-event-${e.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-mono uppercase tracking-wider ${e.kind === "recording" ? "bg-accent/15 text-accent" : "bg-secondary text-muted-foreground"}`} data-testid={`status-kind-${e.id}`}>{e.kind}</span>
        <span className="text-muted-foreground">{e.webhookName}</span>
        <span className="ml-auto font-mono text-muted-foreground" data-testid={`text-received-${e.id}`}>{ts(e.receivedAt)}</span>
      </div>
      {e.transcription && <p className="mt-3 font-display text-2xl leading-snug" data-testid={`text-transcription-${e.id}`}>{e.transcription}</p>}
      {e.kind === "recording" && !e.transcription && <p className="mt-3 text-sm text-muted-foreground">Transcript unavailable</p>}
      {e.audioUrl && (
        <div className="mt-3">
          <audio controls preload="none" src={e.audioUrl} className="w-full" data-testid={`audio-${e.id}`} />
          {e.audioSize != null && <div className="mt-1 font-mono text-[11px] text-muted-foreground">{size(e.audioSize)}</div>}
        </div>
      )}
      {e.recordedAt && <div className="mt-2 font-mono text-[11px] text-muted-foreground">recorded {format(new Date(e.recordedAt), "MMM d, HH:mm:ss")}</div>}
      <button type="button" onClick={() => setOpen(!open)} data-testid={`button-payload-${e.id}`} className="mt-3 text-xs text-muted-foreground hover:text-foreground">
        {open ? "Hide payload" : "Inspect payload"}
      </button>
      {open && <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-primary p-3 font-mono text-[12px] leading-relaxed text-primary-foreground">{JSON.stringify(e.payload, null, 2)}</pre>}
    </article>
  );
}

export default function Inbox() {
  const q = useListEvents(undefined, { query: { queryKey: getListEventsQueryKey(), refetchInterval: 5000 } });
  const [older, setOlder] = useState<InboxEvent[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreErr, setMoreErr] = useState(false);
  const head = q.data?.items ?? [];
  const nextCursor = cursor === undefined ? q.data?.nextCursor : cursor;
  const seen = new Set(head.map((e) => e.id));
  const all = [...head, ...older.filter((e) => !seen.has(e.id))];

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true); setMoreErr(false);
    try { const p = await listEvents({ before: nextCursor }); setOlder((o) => [...o, ...p.items]); setCursor(p.nextCursor); }
    catch { setMoreErr(true); } finally { setLoadingMore(false); }
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <h1 className="font-display text-4xl">Inbox</h1>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="ri-pulse h-1.5 w-1.5 rounded-full bg-accent" />{q.isError ? "Refresh failed" : "Checking every 5s"}</span>
      </div>
      {q.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : q.isError ? (
        <div className="rounded-lg border border-destructive/40 p-5 text-sm">
          Could not load events. <button className="underline" data-testid="button-retry" onClick={() => q.refetch()}>Retry</button>
        </div>
      ) : all.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <div className="mx-auto h-10 w-10 rounded-full border-4 border-muted-foreground/30" />
          <p className="mt-4 font-display text-2xl">Nothing has arrived yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Create a webhook, paste it into the ring app, then press Send test event.</p>
          <Link href="/webhooks" data-testid="link-setup" className="mt-5 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Set up a webhook</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {all.map((e) => <EventCard key={e.id} e={e} />)}
          {nextCursor && (
            <button type="button" onClick={loadMore} disabled={loadingMore} data-testid="button-load-more" className="w-full rounded-md border py-2 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50">
              {loadingMore ? "Loading..." : moreErr ? "Failed, try again" : "Load older events"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
