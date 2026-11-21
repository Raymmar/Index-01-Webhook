import { randomUUID } from "node:crypto";
import { db, pool, reviewRulesTable as rules, reviewRunsTable as runs, eventsTable as messages, actionsTable as tasks, appSettingsTable, type ReviewEffect } from "@workspace/db";
import { and, eq, inArray, isNull, gt, lte, sql } from "drizzle-orm";
import { activeRunStates, enqueueReview, notifyReview, ownerLock, ownedRule, taskState, ReviewError, type Rule } from "./review-rules";
import { nextReviewTime } from "./review-scheduling";
import { reviewContext } from "./review-context";
import { reviewWithAI } from "./review-ai";
import { startJobWakeups } from "./job-wakeups";
import { processingFailure } from "./ai-models";
import { logger } from "./logger";

/** Re-evaluate quiet periods on receipt notifications; persist deadlines for restarts. */
export async function scheduleReviews(now = new Date()) {
  const enabled = await db.select().from(rules).where(eq(rules.enabled, true));
  const [app] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  for (const candidate of enabled) {
    if (!app || (!app.allowSignups && candidate.ownerId !== app.ownerId)) continue;
    await db.transaction(async tx => {
      await ownerLock(tx, candidate.ownerId);
      const [rule] = await tx.select().from(rules).where(eq(rules.id, candidate.id)).for("update");
      if (!rule?.enabled || rule.trigger === "manual") return;
      const [active] = await tx.select().from(runs).where(and(eq(runs.ruleId, rule.id), inArray(runs.status, activeRunStates)));
      if (active) return;
      let at = rule.nextRunAt;
      let start = new Date(now.getTime() - rule.lookbackHours * 3_600_000), end = now;
      if (rule.trigger === "quiet") {
        const [batch] = await tx.select({ count: sql<number>`count(*)::int`, last: sql<Date | null>`max(${messages.receivedAt})` })
          .from(messages).where(and(eq(messages.ownerId, rule.ownerId), isNull(messages.deletedAt), gt(messages.receivedAt, rule.batchCursor), lte(messages.receivedAt, now)));
        at = batch.count > 1 && batch.last ? new Date(new Date(batch.last).getTime() + rule.quietMinutes * 60_000) : null;
        start = rule.batchCursor;
        // Use the scan boundary, not the last message's parsed timestamp:
        // PostgreSQL microseconds must not be rounded into a repeatable cursor.
        end = now;
      } else if (!at) at = nextReviewTime(rule as Rule & Parameters<typeof nextReviewTime>[0], now);
      if (at && at <= now) {
        await enqueueReview(tx, rule, start, end);
        await tx.update(rules).set({
          nextRunAt: nextReviewTime(rule as Rule & Parameters<typeof nextReviewTime>[0], now),
          ...(rule.trigger === "quiet" ? { batchCursor: end } : {}),
        }).where(eq(rules.id, rule.id));
      } else if (at?.getTime() !== rule.nextRunAt?.getTime()) {
        await tx.update(rules).set({ nextRunAt: at }).where(eq(rules.id, rule.id));
        await notifyReview(tx, rule.ownerId);
      }
    });
  }
}

export async function processNextReview(now = new Date()) {
  // At most one runner claims each run. Waiting reviews are reconsidered on
  // server notifications, not a periodic poll.
  const candidates = await db.select().from(runs).where(and(inArray(runs.status, activeRunStates), lte(runs.availableAt, now))).orderBy(runs.createdAt);
  for (const candidate of candidates) {
    const leaseId = randomUUID();
    const claimed = await db.transaction(async tx => {
      await ownerLock(tx, candidate.ownerId);
      const [run] = await tx.select().from(runs).where(eq(runs.id, candidate.id)).for("update");
      if (!run || !activeRunStates.includes(run.status) || run.availableAt > now) return null;
      const rule = await ownedRule(tx, run.ownerId, run.ruleId);
      const [app] = await tx.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
      if (!app || (!app.allowSignups && rule.ownerId !== app.ownerId) || run.ruleRevision !== rule.revision || run.attempts >= 3) {
        await tx.update(runs).set({ status: run.attempts >= 3 ? "failed" : "cancelled", leaseId: null, completedAt: now,
          error: run.attempts >= 3 ? "Review interrupted. Run again to retry." : "Rule or account access changed." }).where(eq(runs.id, run.id));
        await notifyReview(tx, rule.ownerId);
        return { terminal: true } as const;
      }
      // Don't spend a claim/attempt waiting for task extraction.
      const context = await reviewContext(rule, run);
      if (!context) {
        if (run.status !== "waiting") {
          await tx.update(runs).set({ status: "waiting", leaseId: null }).where(eq(runs.id, run.id));
          await notifyReview(tx, rule.ownerId);
        }
        return null;
      }
      await tx.update(runs).set({ status: "processing", leaseId, attempts: run.attempts + 1, availableAt: new Date(now.getTime() + 5 * 60_000), error: null }).where(eq(runs.id, run.id));
      await notifyReview(tx, rule.ownerId);
      return { terminal: false, run, rule, context, app } as const;
    }).catch(async error => {
      if (!(error instanceof ReviewError)) throw error;
      await db.transaction(async tx => {
        await tx.update(runs).set({ status: "failed", error: error.message, completedAt: new Date() })
          .where(and(eq(runs.id, candidate.id), inArray(runs.status, ["pending", "waiting"])));
        await notifyReview(tx, candidate.ownerId);
      });
      return { terminal: true } as const;
    });
    if (!claimed) continue;
    if (claimed.terminal) return true;
    const { rule, run, context, app } = claimed;
    try {
      const result = await reviewWithAI(rule, context.context, app.aiProvider, app.aiModel);
      const sourceIds = new Set(context.sources.map(s => s.id));
      const citations = [...result.sourceIds, ...result.changes.flatMap(c => c.sourceIds)];
      if (citations.some(id => !sourceIds.has(id))) throw new ReviewError("The AI cited sources outside this review.");
      if (context.sources.length && !result.sourceIds.length) throw new ReviewError("The AI returned a report without supporting sources. Run again to retry.");
      if (result.changes.length && rule.output !== "tasks") throw new ReviewError("This rule is not permitted to change tasks.");
      if (new Set(result.changes.map(c => c.taskId)).size !== result.changes.length) throw new ReviewError("The AI returned conflicting changes for one task.");
      const mergingIds = new Set(result.changes.filter(c => c.mergeIntoId).map(c => c.taskId));
      if (result.changes.some(c => c.mergeIntoId && (c.mergeIntoId === c.taskId || mergingIds.has(c.mergeIntoId))))
        throw new ReviewError("The AI returned a circular task merge.");
      await db.transaction(async tx => {
        await ownerLock(tx, rule.ownerId);
        const [currentRun] = await tx.select().from(runs).where(eq(runs.id, run.id)).for("update");
        if (!currentRun || currentRun.status !== "processing" || currentRun.leaseId !== leaseId || currentRun.availableAt <= new Date()) return;
        const currentRule = await ownedRule(tx, rule.ownerId, rule.id);
        if (currentRule.revision !== run.ruleRevision) throw new ReviewError("The rule changed while this review was running.");
        for (const prior of context.prior) {
          const [sourceRun] = await tx.select().from(runs).where(eq(runs.id, prior.id)).for("update");
          if (!sourceRun || sourceRun.undoneAt || sourceRun.status !== "completed")
            throw new ReviewError("An input review changed while this run was processing. Run again.");
        }
        // Protect sources deleted or edited while the model was working.
        for (const note of [...context.notes].sort((a,b) => a.id.localeCompare(b.id))) {
          const [current] = await tx.select().from(messages).where(eq(messages.id, note.id)).for("update");
          if (!current || current.deletedAt || current.transcription !== note.transcription)
            throw new ReviewError("A source message changed during review. Run again with current sources.", 409);
        }
        const effects: ReviewEffect[] = [];
        const affected = new Set(result.changes.flatMap(c => [c.taskId, ...(c.mergeIntoId ? [c.mergeIntoId] : [])]));
        const locked = new Map<string, typeof tasks.$inferSelect>();
        for (const id of [...affected].sort()) {
          const expected = context.actions.find(t => t.id === id);
          const [current] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.ownerId, rule.ownerId))).for("update");
          if (!expected || !current || current.removedAt || current.status !== "open" ||
            JSON.stringify(taskState(current)) !== JSON.stringify(taskState(expected)) ||
            current.pinnedAt?.getTime() !== expected.pinnedAt?.getTime())
            throw new ReviewError("A task changed or is no longer open. Run again with the current board.", 409);
          if (current.editedAt && result.changes.some(c => c.taskId === id)) throw new ReviewError("The review tried to change a manually edited task. It was left untouched.");
          locked.set(id, current);
        }
        for (const change of result.changes) {
          const current = locked.get(change.taskId)!;
          const due = change.setDueDate ? (change.dueAt ? new Date(change.dueAt) : null) : current.dueAt;
          if (change.setDueDate && due && (!Number.isFinite(due.getTime()) || !/(Z|[+-]\d{2}:\d{2})$/.test(change.dueAt!)))
            throw new ReviewError("The AI returned an invalid task date.");
          const after = { title: change.title ?? current.title, dueAt: due?.toISOString() ?? null,
            status: change.mergeIntoId ? "dismissed" : current.status, editedAt: current.editedAt?.toISOString() ?? null };
          const [updated] = await tx.update(tasks).set({ title: after.title, dueAt: due, status: after.status }).where(eq(tasks.id, current.id)).returning();
          effects.push({ taskId: current.id, before: taskState(current), after: taskState(updated) });
        }
        if (rule.output === "overview")
          await tx.update(rules).set({ overview: result.report, overviewUpdatedAt: new Date(), updatedAt: new Date(), revision: currentRule.revision + 1 }).where(eq(rules.id, rule.id));
        const selected = new Set([...citations, ...affected]);
        await tx.update(runs).set({ status: "completed", leaseId: null, completedAt: new Date(), report: result.report,
          sources: context.sources.filter(s => selected.has(s.id)), effects, error: null }).where(eq(runs.id, run.id));
        await notifyReview(tx, rule.ownerId);
      });
    } catch (error) {
      const failure = processingFailure(error);
      const failed = error instanceof ReviewError || !failure.retry || run.attempts + 1 >= 3;
      await db.transaction(async tx => {
        await tx.update(runs).set({
          status: failed ? "failed" : "pending", leaseId: null,
          error: error instanceof ReviewError ? error.message : failure.message,
          completedAt: failed ? new Date() : null, availableAt: new Date(Date.now() + 15_000 * 2 ** run.attempts),
        }).where(and(eq(runs.id, run.id), eq(runs.leaseId, leaseId)));
        await notifyReview(tx, rule.ownerId);
      });
    }
    return true;
  }
  return false;
}

export function startReviewWorker() {
  return startJobWakeups({
    pool,
    async drain() { await scheduleReviews(); return processNextReview(); },
    async nextDeadline() {
      const [next] = await db.select({ at: sql<Date | null>`min(${runs.availableAt})` }).from(runs)
        .where(inArray(runs.status, ["pending", "processing"]));
      const [rule] = await db.select({ at: sql<Date | null>`min(${rules.nextRunAt})` }).from(rules)
        .where(and(eq(rules.enabled, true), sql`NOT EXISTS (SELECT 1 FROM review_runs rr WHERE rr.rule_id = ${rules.id} AND rr.status IN ('pending','processing','waiting'))`,
          sql`EXISTS (SELECT 1 FROM app_settings a WHERE a.id = 1 AND (a.allow_signups OR a.owner_id = ${rules.ownerId}))`));
      const times = [next?.at, rule?.at].filter((d): d is Date => !!d).map(d => new Date(d).getTime());
      return times.length ? Math.min(...times) : null;
    },
    onError: () => logger.warn("Review worker reconnecting or recovering"),
  });
}
