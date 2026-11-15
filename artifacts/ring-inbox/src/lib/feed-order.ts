type Event = { id: string; receivedAt: string };
type Job = { eventId: string; status: string };

export function mergeEvents<T extends Event>(previous: T[], incoming: T[]): T[] {
  const events = new Map(previous.map(event => [event.id, event]));
  for (const event of incoming) events.set(event.id, event);
  return [...events.values()].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || b.id.localeCompare(a.id));
}

export function prioritizeEvents<T extends Event>(events: T[], jobs: Job[], localPending: Set<string>): T[] {
  const statuses = new Map(jobs.map(job => [job.eventId, job.status]));
  const rank = (id: string) => statuses.get(id) === "processing" ? 0 : localPending.has(id) || statuses.get(id) === "pending" ? 1 : 2;
  return [...events].sort((a, b) => rank(a.id) - rank(b.id) || Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || b.id.localeCompare(a.id));
}
