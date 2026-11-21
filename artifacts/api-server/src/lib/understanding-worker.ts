import { randomUUID } from "node:crypto";
import { db, pool, jobsTable, eventsTable, actionsTable, appSettingsTable, preferencesTable } from "@workspace/db";
import { and, eq, lte, lt, or, sql } from "drizzle-orm";
import { startJobWakeups } from "./job-wakeups";
import { extractActions } from "./understanding";
import { logger } from "./logger";
import { processingFailure } from "./ai-models";

export async function processNextJob() {
  const leaseId = randomUUID();
  const job = await db.transaction(async tx => {
    const [candidate] = await tx.select({ job: jobsTable, timezone: preferencesTable.timezone }).from(jobsTable)
      .innerJoin(preferencesTable, eq(preferencesTable.ownerId, jobsTable.ownerId))
      .innerJoin(appSettingsTable, eq(appSettingsTable.id, 1))
      .where(and(
        or(eq(appSettingsTable.allowSignups, true), eq(appSettingsTable.ownerId, jobsTable.ownerId)),
        sql`${preferencesTable.timezone} IS NOT NULL`,
        lte(jobsTable.availableAt, new Date()),
        or(eq(jobsTable.status, "pending"), eq(jobsTable.status, "processing")),
        lt(jobsTable.attempts, 3),
      )).orderBy(jobsTable.availableAt).limit(1).for("update", { skipLocked: true, of: jobsTable });
    if (!candidate) return null;
    const [app] = await tx.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
    if (!app) return null;
    if (app.ownerId !== candidate.job.ownerId && !app.allowSignups) {
      await tx.update(jobsTable).set({ availableAt: new Date(Date.now() + 60_000) }).where(eq(jobsTable.eventId, candidate.job.eventId));
      return null;
    }
    await tx.update(jobsTable).set({
      status: "processing", leaseId, attempts: candidate.job.attempts + 1,
      availableAt: new Date(Date.now() + 5 * 60_000), error: null,
    }).where(eq(jobsTable.eventId, candidate.job.eventId));
    await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${candidate.job.ownerId})`);
    return { ...candidate.job, attempts: candidate.job.attempts + 1, timezone: candidate.timezone!, provider: app.aiProvider, model: app.aiModel };
  });
  if (!job) return false;
  try {
    const [note] = await db.select().from(eventsTable).where(and(eq(eventsTable.id, job.eventId), eq(eventsTable.ownerId, job.ownerId)));
    if (note?.deletedAt) {
      await db.update(jobsTable).set({ status: "completed", leaseId: null, error: null })
        .where(and(eq(jobsTable.eventId, job.eventId), eq(jobsTable.leaseId, leaseId)));
      return true;
    }
    if (!note?.transcription) throw new Error("No transcript");
    const actions = await extractActions({
      transcript: note.transcription, recordedAt: note.recordedAt ?? note.receivedAt, receivedAt: note.receivedAt,
      timezone: job.timezone, provider: job.provider, model: job.model,
    });
    await db.transaction(async tx => {
      const [locked] = await tx.select().from(jobsTable).where(and(eq(jobsTable.eventId, job.eventId), eq(jobsTable.leaseId, leaseId))).for("update");
      if (!locked || locked.status !== "processing" || locked.availableAt <= new Date()) return;
      // A permanent, source-locked initialization barrier makes extraction
      // insert-only. Retries cannot rewrite edits or resurrect tombstoned children.
      const [source] = await tx.select().from(eventsTable).where(and(
        eq(eventsTable.id, job.eventId), eq(eventsTable.ownerId, job.ownerId),
      )).for("update");
      if (source && !source.deletedAt && !source.actionsInitializedAt && !source.editedAt) {
        if (actions.length) await tx.insert(actionsTable).values(actions.map(action => ({
          id: randomUUID(), ownerId: job.ownerId, sourceEventId: job.eventId,
          title: action.title, sourceAction: action.sourceAction, dueAt: action.dueAt,
          timezone: job.timezone, needsReview: action.needsReview,
          originalTimeText: action.originalTimeText,
        })));
        await tx.update(eventsTable).set({ actionsInitializedAt: new Date() })
          .where(eq(eventsTable.id, source.id));
      }
      await tx.update(jobsTable).set({ status: "completed", leaseId: null, error: null }).where(eq(jobsTable.eventId, job.eventId));
      await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${job.ownerId})`);
    });
  } catch (error) {
    const failure = processingFailure(error);
    const failed = !failure.retry || job.attempts >= 3;
    // No provider messages/payloads in logs: they may contain transcripts or keys.
    await db.transaction(async tx => {
      await tx.update(jobsTable).set({
        status: failed ? "failed" : "pending", leaseId: null,
        error: failed ? failure.message : null,
        availableAt: new Date(Date.now() + 15_000 * 2 ** (job.attempts - 1)),
      }).where(and(eq(jobsTable.eventId, job.eventId), eq(jobsTable.leaseId, leaseId)));
      await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${job.ownerId})`);
    });
  }
  return true;
}
export function startUnderstandingWorker() {
  return startJobWakeups({
    pool,
    onError: () => logger.warn("Understanding worker reconnecting or recovering"),
    async drain() {
      // A crashed final attempt must not remain stuck in processing forever.
      await db.transaction(async tx => {
        const expired = await tx.update(jobsTable).set({ status: "failed", leaseId: null, error: "Processing interrupted. Retry this note." })
          .where(and(eq(jobsTable.status, "processing"), sql`${jobsTable.attempts} >= 3`, lte(jobsTable.availableAt, new Date())))
          .returning({ ownerId: jobsTable.ownerId });
        for (const owner of new Set(expired.map(row => row.ownerId))) {
          await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${owner})`);
        }
      });
      return processNextJob();
    },
    async nextDeadline() {
      // Only schedule actual retries/lease recovery, never poll an empty queue.
      // Settings changes already notify this channel when timezone/access changes.
      const [next] = await db.select({ at: sql<Date | null>`min(${jobsTable.availableAt})` }).from(jobsTable)
        .innerJoin(preferencesTable, eq(preferencesTable.ownerId, jobsTable.ownerId))
        .innerJoin(appSettingsTable, eq(appSettingsTable.id, 1))
        .where(and(
          sql`${preferencesTable.timezone} IS NOT NULL`,
          or(eq(appSettingsTable.allowSignups, true), eq(appSettingsTable.ownerId, jobsTable.ownerId)),
          or(eq(jobsTable.status, "processing"), and(eq(jobsTable.status, "pending"), lt(jobsTable.attempts, 3))),
        ));
      return next?.at ? new Date(next.at).getTime() : null;
    },
  });
}
