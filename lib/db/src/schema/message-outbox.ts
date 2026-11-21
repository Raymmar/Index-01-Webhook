import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { eventsTable } from "./webhooks";

// Durable fact of receipt. No model, prompt, provider or AI dependency.
export const messageOutboxTable = pgTable("message_outbox", {
  eventId: text("event_id").primaryKey().references(() => eventsTable.id),
  ownerId: text("owner_id").notNull(),
  type: text("type").notNull().default("message.received"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
}, t => [index("message_outbox_pending_idx").on(t.dispatchedAt, t.availableAt)]);
export const insertMessageOutboxSchema = createInsertSchema(messageOutboxTable);
export type MessageOutbox = typeof messageOutboxTable.$inferSelect;
