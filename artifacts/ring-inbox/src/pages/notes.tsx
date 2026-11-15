import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listEvents, getListEventsQueryKey, useGetOrganizer } from "@workspace/api-client-react";
import { EventCard } from "./inbox";
import { Skeleton } from "@/components/ui/skeleton";

export default function Notes() {
  useEffect(() => { document.title = "Index 0.1 - Pebble Ring Webhook"; }, []);
  const organizer = useGetOrganizer();
  const q = useInfiniteQuery({
    queryKey: [...getListEventsQueryKey({ view: "notes" }), "infinite"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listEvents({ view: "notes", ...(pageParam ? { before: pageParam } : {}) }, { signal }),
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  const notes = [...new Map(q.data?.pages.flatMap(page => page.items).map(note => [note.id, note]) ?? []).values()];

  return (
    <div className="space-y-6" data-testid="notes-page">
      <header>
        <h1 className="font-display text-3xl">Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Inbox messages without an action.</p>
      </header>
      {q.isLoading ? <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>
        : q.isError && !q.data ? <div role="alert" className="rounded-lg border border-border bg-card p-5 text-sm">Could not load notes. <button className="underline" onClick={() => q.refetch()}>Retry</button></div>
        : !notes.length ? <div className="rounded-lg border border-dashed border-border p-10 text-center"><p className="font-display text-2xl">No notes yet.</p></div>
        : <div className="space-y-3">
          {notes.map(note => <EventCard key={note.id} e={note} items={[]} job={organizer.data?.jobs.find(job => job.eventId === note.id)} highlight={false} embedded={false} localPending={false} />)}
          {q.hasNextPage && <button disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} className="w-full rounded-md border border-border py-2 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50">{q.isFetchingNextPage ? "Loading…" : q.isFetchNextPageError ? "Could not load more. Retry" : "Load older notes"}</button>}
          {q.isRefetchError && !q.isFetchNextPageError && <p role="alert" className="text-sm text-destructive">Could not refresh notes. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>}
        </div>}
    </div>
  );
}
