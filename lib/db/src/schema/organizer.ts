import { pgTable, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { eventsTable } from "./webhooks";

export const appSettingsTable = pgTable("app_settings", {
  id: integer("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  allowSignups: boolean("allow_signups").notNull().default(false),
  aiProvider: text("ai_provider").notNull().default("replit"),
  aiModel: text("ai_model").notNull().default("gpt-5-mini"),
});
export const preferencesTable = pgTable("user_preferences", {
  ownerId: text("owner_id").primaryKey(),
  timezone: text("timezone"),
  taskRules: text("task_rules"),
  dateRules: text("date_rules"),
  titleStyle: text("title_style"),
  personalContext: text("personal_context"),
  skipTaskDismissConfirmation: boolean("skip_task_dismiss_confirmation").notNull().default(false),
  skipTaskDeleteConfirmation: boolean("skip_task_delete_confirmation").notNull().default(false),
  skipMessageDeleteConfirmation: boolean("skip_message_delete_confirmation").notNull().default(false),
});
export const jobsTable = pgTable("understanding_jobs", {
  processor: text("processor").notNull().default("task-extraction"),
  processorVersion: integer("processor_version").notNull().default(1),
  model: text("model"),
  provider: text("provider"),
  eventId: text("event_id").primaryKey().references(() => eventsTable.id),
  ownerId: text("owner_id").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseId: text("lease_id"),
  error: text("error"),
}, (t) => [index("jobs_owner_idx").on(t.ownerId)]);
// Legacy extraction archive, retained for lossless migration/history only.
// Never read these archival rows as active actions.
export const itemsTable = pgTable("action_items", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  sourceEventId: text("source_event_id").references(() => eventsTable.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  timezone: text("timezone").notNull(),
  status: text("status").notNull().default("open"),
  needsReview: boolean("needs_review").notNull().default(false),
  originalTimeText: text("original_time_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("items_owner_idx").on(t.ownerId)]);

export const actionsTable = pgTable("active_actions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  sourceEventId: text("source_event_id").notNull().references(() => eventsTable.id),
  title: text("title").notNull(),
  sourceAction: text("source_action"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  timezone: text("timezone").notNull(),
  status: text("status").notNull().default("open"),
  needsReview: boolean("needs_review").notNull().default(false),
  originalTimeText: text("original_time_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
}, (t) => [index("actions_owner_source_idx").on(t.ownerId, t.sourceEventId)]);
