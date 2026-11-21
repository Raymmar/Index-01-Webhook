import { randomUUID } from "node:crypto";
import { db, reviewRulesTable as rules, reviewRunsTable as runs, actionsTable, type ReviewEffect } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { GetReviewRuleResponse, RunReviewRuleResponse, type ReviewRuleInput } from "@workspace/api-zod";
import { nextReviewTime, assertAcyclic } from "./review-scheduling";

export type Rule = typeof rules.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const activeRunStates = ["pending", "waiting", "processing"];
export const notifyReview = (tx: Tx, ownerId: string) => tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${ownerId})`);
export const ruleResponse = (rule: Rule) => GetReviewRuleResponse.parse(rule);
export const runResponse = (run: Run) => RunReviewRuleResponse.parse({ ...run, changedTaskIds: run.effects.map(e => e.taskId) });
export class ReviewError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function ownerLock(tx: Tx, ownerId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`review:${ownerId}`}))`);
}
export async function ownedRule(tx: Tx, ownerId: string, id: string) {
  const [rule] = await tx.select().from(rules).where(and(eq(rules.ownerId, ownerId), eq(rules.id, id))).for("update");
  if (!rule) throw new ReviewError("Rule not found", 404);
  return rule;
}
export async function validateRule(tx: Tx, ownerId: string, id: string, input: ReviewRuleInput) {
  if (!input.name.trim() || !input.prompt.trim()) throw new ReviewError("Give the rule a name and instructions.");
  try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(); }
  catch { throw new ReviewError("Choose a valid timezone."); }
  if (input.output === "tasks" && !input.includeTasks) throw new ReviewError("Include tasks to allow task changes.");
  if (!input.includeMessages && !input.includeTasks && !input.inputRuleIds.length)
    throw new ReviewError("Choose messages, tasks, or another rule's output as input.");
  if (new Set(input.inputRuleIds).size !== input.inputRuleIds.length) throw new ReviewError("Choose each input rule only once.");
  const all = await tx.select().from(rules).where(eq(rules.ownerId, ownerId));
  if (all.length >= 50 && !all.some(r => r.id === id)) throw new ReviewError("This account already has 50 review rules.");
  if (input.inputRuleIds.some(dep => !all.some(r => r.id === dep))) throw new ReviewError("Choose input rules belonging to this account.");
  try { assertAcyclic(id, input.inputRuleIds, new Map(all.map(r => [r.id, r.inputRuleIds]))); }
  catch (error) { throw new ReviewError((error as Error).message); }
}
export async function saveReviewRule(ownerId: string, id: string | undefined, input: ReviewRuleInput) {
  return db.transaction(async tx => {
    await ownerLock(tx, ownerId);
    const old = id ? await ownedRule(tx, ownerId, id) : undefined;
    const ruleId = id ?? randomUUID();
    await validateRule(tx, ownerId, ruleId, input);
    const now = new Date();
    const values = { ...input, name: input.name.trim(), updatedAt: now, nextRunAt: nextReviewTime(input, now) };
    let rule: Rule;
    if (old) {
      [rule] = await tx.update(rules).set({ ...values, revision: old.revision + 1,
        // Don't include messages received while disabled in a newly enabled batch.
        ...(!old.enabled || old.trigger !== input.trigger ? { batchCursor: now } : {}),
      }).where(eq(rules.id, ruleId)).returning();
      await tx.update(runs).set({ status: "cancelled", leaseId: null, completedAt: now, error: "Rule changed; run cancelled." })
        .where(and(eq(runs.ruleId, ruleId), inArray(runs.status, activeRunStates)));
    } else {
      [rule] = await tx.insert(rules).values({ ...values, id: ruleId, ownerId, batchCursor: now }).returning();
    }
    await notifyReview(tx, ownerId);
    return rule;
  });
}
export async function enqueueReview(tx: Tx, rule: Rule, start: Date, end: Date) {
  const [active] = await tx.select().from(runs).where(and(eq(runs.ruleId, rule.id), inArray(runs.status, activeRunStates)));
  if (active) return active;
  const [run] = await tx.insert(runs).values({
    id: randomUUID(), ownerId: rule.ownerId, ruleId: rule.id, ruleRevision: rule.revision,
    windowStart: start, windowEnd: end,
  }).returning();
  await notifyReview(tx, rule.ownerId);
  return run;
}
export function taskState(task: typeof actionsTable.$inferSelect): ReviewEffect["before"] {
  return { title: task.title, dueAt: task.dueAt?.toISOString() ?? null, status: task.status, editedAt: task.editedAt?.toISOString() ?? null };
}
export async function undoReview(ownerId: string, ruleId: string, runId: string) {
  return db.transaction(async tx => {
    await ownerLock(tx, ownerId);
    await ownedRule(tx, ownerId, ruleId);
    const [run] = await tx.select().from(runs).where(and(eq(runs.id, runId), eq(runs.ruleId, ruleId))).for("update");
    if (!run) throw new ReviewError("Review not found", 404);
    if (run.undoneAt) return run;
    for (const effect of [...run.effects].sort((a,b) => a.taskId.localeCompare(b.taskId))) {
      const [task] = await tx.select().from(actionsTable).where(and(eq(actionsTable.id, effect.taskId), eq(actionsTable.ownerId, ownerId))).for("update");
      if (!task || task.removedAt || (Object.keys(effect.after) as (keyof ReviewEffect["after"])[])
        .some(key => taskState(task)[key] !== effect.after[key]))
        throw new ReviewError("A task changed after this review. Undo would overwrite newer changes.", 409);
      await tx.update(actionsTable).set({
        ...effect.before, dueAt: effect.before.dueAt ? new Date(effect.before.dueAt) : null,
        editedAt: effect.before.editedAt ? new Date(effect.before.editedAt) : null,
      }).where(eq(actionsTable.id, task.id));
    }
    const [updated] = await tx.update(runs).set({ undoneAt: new Date() }).where(eq(runs.id, runId)).returning();
    await notifyReview(tx, ownerId);
    return updated;
  });
}
