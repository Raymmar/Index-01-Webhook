import { replaceEqualDeep } from "@tanstack/react-query";
import type { EventPage } from "@workspace/api-client-react";

/** React Query's default array sharing compares by index. Prepending one note
 * therefore clones every shifted note, invalidating every memoized card.
 * Compare notes by identity instead; changed server fields still flow through.
 */
export function shareFeedPage(previous: unknown, incoming: unknown): EventPage {
  const next = incoming as EventPage;
  const old = previous as EventPage | undefined;
  if (!old) return next;
  const byId = new Map(old.items.map(event => [event.id, event]));
  return {
    ...next,
    items: next.items.map(event => replaceEqualDeep(byId.get(event.id), event)),
  };
}
