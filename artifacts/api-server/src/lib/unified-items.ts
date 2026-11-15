import { db, eventsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

/** One-time, transactional conversion. Legacy action rows remain as an archive. */
export async function migrateUnifiedItems() {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7842361)`);
    // Hand-created actions become the same inbox primitive, without a webhook.
    await tx.execute(sql`
      INSERT INTO inbox_events (id, owner_id, kind, transcription, payload, received_at,
        is_actionable, action_title, due_at, timezone, status, needs_review, original_time_text, unified_at)
      SELECT id, owner_id, 'json', title, '{"source":"manual"}'::jsonb, created_at,
        true, title, due_at, timezone, status, needs_review, original_time_text, now()
      FROM action_items WHERE source_event_id IS NULL
      ON CONFLICT (id) DO NOTHING
    `);
    // Multiple historic extractions become one message's action summary.
    // All original per-action details remain in action_items, unmodified.
    await tx.execute(sql`
      WITH grouped AS (
        SELECT source_event_id, owner_id,
          string_agg(title, '; ' ORDER BY created_at, id) AS title,
          min(due_at) FILTER (WHERE status='open') AS open_due,
          min(due_at) AS any_due,
          (array_agg(timezone ORDER BY due_at NULLS LAST, created_at, id))[1] AS timezone,
          CASE WHEN bool_and(status='completed') THEN 'completed'
               WHEN bool_and(status='dismissed') THEN 'dismissed' ELSE 'open' END AS status,
          bool_or(needs_review) AS review,
          string_agg(original_time_text, '; ' ORDER BY created_at, id) AS time_text
        FROM action_items WHERE source_event_id IS NOT NULL GROUP BY source_event_id, owner_id
      )
      UPDATE inbox_events e SET
        is_actionable=true, action_title=g.title, due_at=coalesce(g.open_due,g.any_due),
        timezone=g.timezone, status=g.status, needs_review=g.review,
        original_time_text=g.time_text, unified_at=now()
      FROM grouped g WHERE e.id=g.source_event_id AND e.owner_id=g.owner_id AND e.unified_at IS NULL
        AND lower(trim(coalesce(e.transcription,''))) NOT IN ('index webhook test event','index webhook test event.','index webhook test event!')
    `);
    await tx.execute(sql`UPDATE inbox_events SET unified_at=now() WHERE unified_at IS NULL`);
  });
}

export function publicAction(item: typeof eventsTable.$inferSelect) {
  return {
    id: item.id, sourceEventId: item.id, kind: "task" as const,
    title: item.actionTitle ?? item.transcription ?? "", dueAt: item.dueAt?.toISOString() ?? null,
    timezone: item.timezone, status: item.status, needsReview: item.needsReview,
    originalTimeText: item.originalTimeText, createdAt: item.receivedAt.toISOString(),
  };
}
