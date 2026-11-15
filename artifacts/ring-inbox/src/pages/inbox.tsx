import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Code2 } from "lucide-react";
import { useListEvents, getListEventsQueryKey, listEvents, type InboxEvent } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useInboxStream } from "@/hooks/use-inbox-stream";

function ts(s: string) { return format(new Date(s), "MMM d, h:mm a"); }
function size(n: number) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`; }

function EventCard({ e }: { e: InboxEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="ri-in rounded-lg border border-border bg-card p-3" data-testid={`card-event-${e.id}`}>
      {e.transcription ? <p className="whitespace-pre-wrap break-words font-sans text-lg font-normal leading-relaxed" data-testid={`text-transcription-${e.id}`}>{e.transcription}</p> : <p className="text-sm text-muted-foreground">{e.kind === "recording" ? "Transcript unavailable" : "Webhook event received"}</p>}
      {e.audioUrl && (
        <div className="mt-2">
          <audio controls preload="none" src={e.audioUrl} className="h-8 w-full" data-testid={`audio-${e.id}`} />
        </div>
      )}
      <footer className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-1 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="max-w-40 truncate" title={e.webhookName}>{e.webhookName}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={e.recordedAt || e.receivedAt} title={`${e.recordedAt ? "Recorded" : "Received"} ${format(new Date(e.recordedAt || e.receivedAt), "PPpp")}`} data-testid={`text-received-${e.id}`}>{ts(e.recordedAt || e.receivedAt)}</time>
          {e.audioSize != null && <><span aria-hidden="true">·</span><span>{size(e.audioSize)}</span></>}
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? "Hide payload" : "Show payload"} title={open ? "Hide payload" : "Show payload"} aria-expanded={open} aria-controls={`payload-${e.id}`} data-testid={`button-payload-${e.id}`} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${open ? "bg-secondary text-foreground" : ""}`}>
          <Code2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </footer>
      <pre id={`payload-${e.id}`} hidden={!open} aria-label="Event payload" className="mt-2 max-h-80 overflow-auto rounded-md bg-primary p-3 font-mono text-[12px] leading-relaxed text-primary-foreground">{JSON.stringify(e.payload, null, 2)}</pre>
    </article>
  );
}

export default function Inbox() {
  const q = useListEvents(undefined, { query: { queryKey: getListEventsQueryKey() } });
  const streamStatus = useInboxStream();
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
        <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${streamStatus === "live" ? "bg-accent" : "bg-muted-foreground"}`} />{q.isError ? "Refresh failed" : streamStatus === "live" ? "Live" : streamStatus === "connecting" ? "Connecting…" : "Reconnecting…"}</span>
      </div>
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
          {all.map((e) => <EventCard key={e.id} e={e} />)}
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
