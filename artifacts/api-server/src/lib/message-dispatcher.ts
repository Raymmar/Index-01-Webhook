import { db, pool, eventsTable, jobsTable, messageOutboxTable } from "@workspace/db";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { startJobWakeups } from "./job-wakeups";
import { logger } from "./logger";

/** The first consumer of message.received. Future consumers belong here, not in adapters. */
export async function dispatchNextMessage() {
  return db.transaction(async tx => {
    const [receipt] = await tx.select().from(messageOutboxTable)
      .where(and(eq(messageOutboxTable.type, "message.received"), isNull(messageOutboxTable.dispatchedAt), lte(messageOutboxTable.availableAt, new Date())))
      .orderBy(messageOutboxTable.createdAt).limit(1).for("update", { skipLocked: true });
    if (!receipt) return false;
    // SAVEPOINT lets dispatch failure be recorded without losing the receipt.
    try {
      await tx.transaction(async step => {
        const [source] = await step.select().from(eventsTable).where(and(
          eq(eventsTable.id, receipt.eventId), eq(eventsTable.ownerId, receipt.ownerId),
        )).for("update");
        if (source && !source.deletedAt && !source.actionsInitializedAt && !source.editedAt && source.transcription?.trim()) {
          await step.insert(jobsTable).values({ eventId: source.id, ownerId: source.ownerId, processor: "task-extraction", processorVersion: 1 }).onConflictDoNothing();
        }
        await step.update(messageOutboxTable).set({ dispatchedAt: new Date(), error: null })
          .where(eq(messageOutboxTable.eventId, receipt.eventId));
      });
    } catch {
      await tx.update(messageOutboxTable).set({
        attempts: receipt.attempts + 1, error: "Processing handoff failed; retry scheduled.",
        availableAt: new Date(Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(receipt.attempts, 8))),
      }).where(eq(messageOutboxTable.eventId, receipt.eventId));
    }
    await tx.execute(sql`SELECT pg_notify('ring_inbox_changed', ${receipt.ownerId})`);
    return true;
  });
}
export function startMessageDispatcher() {
  return startJobWakeups({
    pool, drain: dispatchNextMessage,
    onError: () => logger.warn("Message dispatcher reconnecting or recovering"),
    async nextDeadline() {
      const [row] = await db.select({ at: sql<Date | null>`min(${messageOutboxTable.availableAt})` })
        .from(messageOutboxTable).where(and(eq(messageOutboxTable.type, "message.received"), isNull(messageOutboxTable.dispatchedAt)));
      return row?.at ? new Date(row.at).getTime() : null;
    },
  });
}
