import { pgTable, text, timestamp, integer, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const webhooksTable = pgTable("webhooks", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  eventCount: integer("event_count").default(0).notNull(),
}, (t) => [index("webhooks_owner_idx").on(t.ownerId)]);

export const eventsTable = pgTable("inbox_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  webhookId: text("webhook_id").references(() => webhooksTable.id),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }),
  kind: text("kind").notNull(),
  transcription: text("transcription"),
  audioPath: text("audio_path"),
  audioSize: integer("audio_size"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  isActionable: boolean("is_actionable").notNull().default(false),
  actionTitle: text("action_title"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  timezone: text("timezone").notNull().default("UTC"),
  status: text("status").notNull().default("open"),
  needsReview: boolean("needs_review").notNull().default(false),
  originalTimeText: text("original_time_text"),
  unifiedAt: timestamp("unified_at", { withTimezone: true }),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  actionsInitializedAt: timestamp("actions_initialized_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("events_owner_received_idx").on(t.ownerId, t.receivedAt, t.id)]);

export const insertWebhookSchema = createInsertSchema(webhooksTable);
export const insertEventSchema = createInsertSchema(eventsTable);
export type WebhookRow = typeof webhooksTable.$inferSelect;
