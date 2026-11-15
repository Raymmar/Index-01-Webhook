import { useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getListEventsQueryKey, listEvents, type EventPage } from "@workspace/api-client-react";
import { mergeEvents } from "@/lib/feed-order";
import { refreshFeed, singleFlight } from "@/lib/feed-pagination";
import { shareFeedPage } from "@/lib/feed-sharing";

const PAGE_SIZE = 20;
// Keep the events prefix so the existing SSE invalidation also refreshes this feed.
const key = [...getListEventsQueryKey({ pageSize: PAGE_SIZE }), "feed"];
const flights = new WeakMap<QueryClient, ReturnType<typeof singleFlight>>();

export function useInboxFeed() {
  const client = useQueryClient();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreErr, setMoreErr] = useState(false);
  const blocked = useRef(false);
  const busy = useRef(false);
  const q = useQuery({
    queryKey: key,
    structuralSharing: shareFeedPage,
    retry: false,
    queryFn: async ({ signal }) => {
      const page = await refreshFeed(client.getQueryData<EventPage>(key), before =>
        listEvents({ pageSize: PAGE_SIZE, ...(before ? { before } : {}) }, { signal }));
      // An older-page request may have completed while the head was refreshing.
      const current = client.getQueryData<EventPage>(key);
      return current ? { items: mergeEvents(current.items, page.items), nextCursor: current.items.length ? current.nextCursor : page.nextCursor } : page;
    },
  });

  async function loadMore(manual = false) {
    if (busy.current || (blocked.current && !manual)) return;
    const before = client.getQueryData<EventPage>(key)?.nextCursor;
    if (!before) return;
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    busy.current = true;
    blocked.current = false;
    setLoadingMore(true);
    setMoreErr(false);
    let run = flights.get(client);
    if (!run) { run = singleFlight(); flights.set(client, run); }
    try {
      await run(async () => {
        const page = await listEvents({ pageSize: PAGE_SIZE, before });
        if (page.nextCursor === before) throw new Error("Inbox cursor did not advance");
        // Signing out clears the cache. Do not write an old account's response
        // into a replacement query created by the next account.
        if (client.getQueryCache().find({ queryKey: key, exact: true }) !== query) return;
        client.setQueryData<EventPage>(key, current => current
          ? { items: mergeEvents(current.items, page.items), nextCursor: page.nextCursor }
          : undefined);
      });
    } catch {
      blocked.current = true;
      setMoreErr(true);
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }
  return { ...q, loadingMore, moreErr, loadMore };
}
