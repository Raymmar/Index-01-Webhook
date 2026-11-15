import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
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
  webhookId: text("webhook_id").notNull().references(() => webhooksTable.id),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }),
  kind: text("kind").notNull(),
  transcription: text("transcription"),
  audioPath: text("audio_path"),
  audioSize: integer("audio_size"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
}, (t) => [index("events_owner_received_idx").on(t.ownerId, t.receivedAt, t.id)]);

export const insertWebhookSchema = createInsertSchema(webhooksTable);
export const insertEventSchema = createInsertSchema(eventsTable);
export type WebhookRow = typeof webhooksTable.$inferSelect;
