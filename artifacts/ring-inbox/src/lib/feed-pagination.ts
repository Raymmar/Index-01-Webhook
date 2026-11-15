import { mergeEvents } from "./feed-order.ts";

type Event = { id: string; receivedAt: string };
export type FeedPage<T extends Event> = { items: T[]; nextCursor: string | null };

/** Bridge a refreshed head to the previously loaded head before publishing it.
 * A burst larger than one page must not leave a hole above the retained history.
 * Keep the history cursor separate: a refreshed head cannot move that boundary.
 */
export async function refreshFeed<T extends Event>(
  previous: FeedPage<T> | undefined,
  fetchPage: (before?: string) => Promise<FeedPage<T>>,
): Promise<FeedPage<T>> {
  let page = await fetchPage();
  const initialCursor = page.nextCursor;
  let incoming = page.items;
  const known = new Set(previous?.items.map(event => event.id));
  const cursors = new Set<string>();
  while (known.size && page.nextCursor && !page.items.some(event => known.has(event.id))) {
    if (cursors.has(page.nextCursor)) throw new Error("Inbox cursor did not advance");
    cursors.add(page.nextCursor);
    page = await fetchPage(page.nextCursor);
    incoming = mergeEvents(incoming, page.items);
  }
  return {
    items: mergeEvents(previous?.items ?? [], incoming),
    nextCursor: previous?.items.length ? previous.nextCursor : initialCursor,
  };
}

/** Shared synchronous guard, including between two mounted copies of the feed. */
export function singleFlight() {
  let pending: Promise<void> | undefined;
  return (request: () => Promise<void>) => {
    if (!pending) pending = Promise.resolve().then(request).finally(() => { pending = undefined; });
    return pending;
  };
}
