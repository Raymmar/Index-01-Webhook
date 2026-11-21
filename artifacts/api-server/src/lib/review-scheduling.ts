import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { ReviewRuleInput } from "@workspace/api-zod";

export function nextReviewTime(rule: Pick<ReviewRuleInput, "enabled" | "trigger" | "intervalHours" | "dailyTime" | "timezone">, after: Date): Date | null {
  if (!rule.enabled || rule.trigger === "manual" || rule.trigger === "quiet") return null;
  if (rule.trigger === "hourly") return new Date(after.getTime() + rule.intervalHours * 3_600_000);
  const localDate = formatInTimeZone(after, rule.timezone, "yyyy-MM-dd");
  for (let day = 0; day < 3; day++) {
    const date = new Date(`${localDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day);
    const expected = `${date.toISOString().slice(0, 10)}T${rule.dailyTime}`;
    let candidate = fromZonedTime(expected, rule.timezone);
    // If the chosen wall time is skipped by daylight saving, use the next
    // existing minute that day. Never reinterpret a daily cadence as 24 hours.
    for (let minute = 0; minute < 180 && formatInTimeZone(candidate, rule.timezone, "yyyy-MM-dd'T'HH:mm") < expected; minute++)
      candidate = new Date(candidate.getTime() + 60_000);
    if (candidate > after) return candidate;
  }
  throw new Error("Could not calculate the daily schedule");
}

export function assertAcyclic(id: string, inputs: string[], graph: Map<string, string[]>) {
  const visiting = new Set<string>(), visited = new Set<string>();
  graph.set(id, inputs);
  const visit = (node: string) => {
    if (visiting.has(node)) throw new Error("Rules cannot depend on themselves or form a cycle.");
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dep of graph.get(node) ?? []) visit(dep);
    visiting.delete(node); visited.add(node);
  };
  visit(id);
}
