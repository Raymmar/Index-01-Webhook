import type { QueryClient } from "@tanstack/react-query";
import type { ActionItem } from "./generated/api.schemas";

type OrderedTask = Pick<ActionItem, "id" | "createdAt" | "dueAt"> & { pinnedAt?: string | null };
export const TASK_UNDO_MS = 15_000;

/** Pins first, then due-date urgency, then newest creation; stable ties by ID. */
export function compareTasks(a: OrderedTask, b: OrderedTask): number {
  const timestamp = (value: string | null | undefined, fallback: number) => {
    const time = value ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? time : fallback;
  };
  const aPin = timestamp(a.pinnedAt, -Infinity), bPin = timestamp(b.pinnedAt, -Infinity);
  if (aPin !== bPin) return aPin > bPin ? -1 : 1;
  const aDue = timestamp(a.dueAt, Infinity), bDue = timestamp(b.dueAt, Infinity);
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  return timestamp(b.createdAt, 0) - timestamp(a.createdAt, 0) || a.id.localeCompare(b.id);
}
export function tasksForMessage(items: ActionItem[], eventId: string) {
  return items.filter(item => item.sourceEventId === eventId).sort(compareTasks);
}
export function groupTasksByMessage(items: ActionItem[]) {
  const groups = new Map<string, ActionItem[]>();
  for (const item of items) if (item.sourceEventId) {
    const group = groups.get(item.sourceEventId);
    if (group) group.push(item);
    else groups.set(item.sourceEventId, [item]);
  }
  for (const group of groups.values()) group.sort(compareTasks);
  return groups;
}
export type TaskFilter = "all" | "scheduled" | "unscheduled";
export function matchesTask(item: ActionItem, status: ActionItem["status"], filter: TaskFilter) {
  return item.status === status && (filter === "all" || (filter === "scheduled" ? Boolean(item.dueAt) : !item.dueAt));
}
/** Transport-independent SSE/reconnect/mutation refresh policy. No polling. */
export function refreshInbox(client: QueryClient) {
  return client.invalidateQueries({ predicate: query => {
    const key = query.queryKey[0];
    return typeof key === "string" && (
      ["/api/events", "/api/organizer", "/api/webhooks", "/api/settings", "/api/prompts"].includes(key) ||
      key.startsWith("/api/events/")
    );
  } });
}
