import { randomUUID } from "node:crypto";
import { db, jobsTable, eventsTable, appSettingsTable, preferencesTable, itemsTable } from "@workspace/db";
import { and, eq, lte, lt, or, sql } from "drizzle-orm";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { extractActions } from "./understanding";
import { logger } from "./logger";

let running = false;
export async function processNextJob() {
  const leaseId = randomUUID();
  const job = await db.transaction(async tx => {
    const [candidate] = await tx.select({ job: jobsTable, timezone: preferencesTable.timezone }).from(jobsTable)
      .innerJoin(preferencesTable, eq(preferencesTable.ownerId, jobsTable.ownerId))
      .where(and(
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
    const [note] = await db.select().from(eventsTable).where(eq(eventsTable.id, job.eventId));
    if (!note?.transcription) throw new Error("No transcript");
    const actions = await extractActions({
      transcript: note.transcription, recordedAt: note.recordedAt ?? note.receivedAt,
      timezone: job.timezone, provider: job.provider, model: job.model,
    });
    await db.transaction(async tx => {
      const [locked] = await tx.select().from(jobsTable).where(and(eq(jobsTable.eventId, job.eventId), eq(jobsTable.leaseId, leaseId))).for("update");
      if (!locked || locked.status !== "processing") return;
      if (actions.length) await tx.insert(itemsTable).values(actions.map(item => ({
        id: randomUUID(), ownerId: job.ownerId, sourceEventId: job.eventId, kind: item.kind,
        title: item.title, dueAt: item.dueAt, timezone: job.timezone,
        needsReview: item.needsReview, originalTimeText: item.originalTimeText,
      })));
      await tx.update(jobsTable).set({ status: "completed", leaseId: null, error: null }).where(eq(jobsTable.eventId, job.eventId));
      await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${job.ownerId})`);
    });
  } catch {
    // No provider messages/payloads in logs: they may contain transcripts or keys.
    await db.transaction(async tx => {
      await tx.update(jobsTable).set({
        status: job.attempts >= 3 ? "failed" : "pending", leaseId: null,
        error: job.attempts >= 3 ? "Could not organize this note. Check AI settings and retry." : null,
        availableAt: new Date(Date.now() + 15_000 * 2 ** (job.attempts - 1)),
      }).where(and(eq(jobsTable.eventId, job.eventId), eq(jobsTable.leaseId, leaseId)));
      await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${job.ownerId})`);
    });
  }
  return true;
}
export function startUnderstandingWorker() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // A crashed final attempt must not remain stuck in processing forever.
      await db.update(jobsTable).set({ status: "failed", leaseId: null, error: "Processing interrupted. Retry this note." })
        .where(and(eq(jobsTable.status, "processing"), sql`${jobsTable.attempts} >= 3`, lte(jobsTable.availableAt, new Date())));
      await batchProcess([0], () => processNextJob(), { concurrency: 1, retries: 0 });
    } catch { logger.warn("Understanding worker will retry on its next run"); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 5_000);
  timer.unref();
  return () => clearInterval(timer);
}
