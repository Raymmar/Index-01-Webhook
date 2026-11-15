import { db, actionsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Backfill current scalar values only, never the legacy extraction archive.
 * The source marker is permanent, including after the last child is removed.
 * Pending untouched messages remain eligible for their first extraction.
 */
export async function migrateUnifiedItems() {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7842361)`);
    await tx.execute(sql`
      INSERT INTO active_actions (id, owner_id, source_event_id, title, due_at,
        timezone, status, needs_review, original_time_text, created_at, edited_at)
      SELECT 'migrated:' || id, owner_id, id, coalesce(action_title, transcription, ''),
        due_at, timezone, status, needs_review, original_time_text, received_at, edited_at
      FROM inbox_events WHERE is_actionable AND actions_initialized_at IS NULL
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      UPDATE inbox_events e SET actions_initialized_at=now()
      WHERE actions_initialized_at IS NULL AND (
        is_actionable OR edited_at IS NOT NULL OR
        EXISTS (SELECT 1 FROM understanding_jobs j WHERE j.event_id=e.id
          AND j.owner_id=e.owner_id AND j.status='completed')
      )
    `);
  });
}

export function publicAction(item: typeof actionsTable.$inferSelect) {
  return {
    id: item.id, sourceEventId: item.sourceEventId, kind: "task" as const,
    title: item.title, dueAt: item.dueAt?.toISOString() ?? null,
    timezone: item.timezone, status: item.status, needsReview: item.needsReview,
    originalTimeText: item.originalTimeText, createdAt: item.createdAt.toISOString(),
  };
}
