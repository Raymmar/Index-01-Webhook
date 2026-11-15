type Event = { id: string };

/** The chronological head is independent of processing-priority display order.
 * Appended history and updates to existing records are not new arrivals. */
export function newArrivalIds(previous: Event[], current: Event[]): string[] {
  if (!previous.length) return [];
  const boundary = current.findIndex(event => event.id === previous[0].id);
  if (boundary <= 0) return [];
  const known = new Set(previous.map(event => event.id));
  return current.slice(0, boundary).filter(event => !known.has(event.id)).map(event => event.id);
}
