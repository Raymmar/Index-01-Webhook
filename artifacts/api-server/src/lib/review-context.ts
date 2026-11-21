import { db, eventsTable as messages, actionsTable as tasks, jobsTable, reviewRunsTable as runs, type ReviewSource } from "@workspace/db";
import { and, eq, gt, lte, inArray, isNull, desc, or, gte } from "drizzle-orm";
import { type Rule, type Run, ReviewError } from "./review-rules";

/** Bounded inputs only. Never send the entire account or silently truncate. */
export async function reviewContext(rule: Rule, run: Run) {
  const notes = rule.includeMessages || rule.includeTasks ? await db.select().from(messages).where(and(
    eq(messages.ownerId, rule.ownerId), isNull(messages.deletedAt),
    gt(messages.receivedAt, run.windowStart), lte(messages.receivedAt, run.windowEnd),
  )).orderBy(messages.receivedAt, messages.id).limit(101) : [];
  if (notes.length > 100) throw new ReviewError("This window contains more than 100 messages. Shorten the rule's lookback or batch.");
  const noteIds = notes.map(n => n.id);
  if (rule.includeTasks && noteIds.length) {
    const jobs = await db.select().from(jobsTable).where(and(eq(jobsTable.ownerId, rule.ownerId), inArray(jobsTable.eventId, noteIds)));
    // Only the review waits: neither ingestion nor extraction knows this rule exists.
    if (notes.some(n => n.transcription?.trim() && !n.actionsInitializedAt && !n.editedAt &&
      (!jobs.some(j => j.eventId === n.id) || jobs.some(j => j.eventId === n.id && ["pending", "processing"].includes(j.status)))))
      return null;
  }
  const actions = rule.includeTasks ? await db.select({ task: tasks }).from(tasks)
    .innerJoin(messages, eq(messages.id, tasks.sourceEventId))
    .where(and(eq(tasks.ownerId, rule.ownerId), isNull(tasks.removedAt), isNull(messages.deletedAt),
      // Open work plus recently changed/created closed work gives the review context.
      or(eq(tasks.status, "open"), gte(tasks.createdAt, run.windowStart), gte(tasks.editedAt, run.windowStart)),
      lte(tasks.createdAt, run.windowEnd)))
    .orderBy(tasks.createdAt, tasks.id).limit(201) : [];
  if (actions.length > 200) throw new ReviewError("This review has more than 200 relevant tasks. Exclude tasks or narrow your active board.");
  const prior = rule.inputRuleIds.length ? await db.select().from(runs).where(and(
    eq(runs.ownerId, rule.ownerId), inArray(runs.ruleId, rule.inputRuleIds), eq(runs.status, "completed"),
    isNull(runs.undoneAt), gt(runs.createdAt, run.windowStart), lte(runs.createdAt, run.windowEnd),
  )).orderBy(desc(runs.createdAt)).limit(51) : [];
  if (prior.length > 50) throw new ReviewError("This window contains more than 50 input reviews. Shorten the lookback.");
  const sources: ReviewSource[] = [
    ...(rule.includeMessages ? notes.map(n => ({ kind: "message" as const, id: n.id, label: n.transcription?.slice(0, 100) || "Message" })) : []),
    ...actions.map(({ task: t }) => ({ kind: "task" as const, id: t.id, label: t.title })),
    ...prior.map(r => ({ kind: "review" as const, id: r.id, label: r.report?.slice(0, 100) || "Review" })),
  ];
  const context = {
    windowStart: run.windowStart, windowEnd: run.windowEnd, timezone: rule.timezone,
    previousOverview: rule.output === "overview" ? rule.overview : null,
    messages: rule.includeMessages ? notes.map(n => ({ id: n.id, receivedAt: n.receivedAt, text: n.transcription })) : [],
    tasks: actions.map(({ task: t }) => ({ id: t.id, sourceMessageId: t.sourceEventId, title: t.title, dueAt: t.dueAt, status: t.status, manuallyEdited: !!t.editedAt, pinnedAt: t.pinnedAt })),
    reviews: prior.map(r => ({ id: r.id, ruleId: r.ruleId, windowStart: r.windowStart, windowEnd: r.windowEnd, report: r.report })),
  };
  if (JSON.stringify(context).length > 100_000) throw new ReviewError("This review's context is too large. Shorten its lookback or reduce inputs.");
  return { context, sources, notes, prior, actions: actions.map(a => a.task) };
}
