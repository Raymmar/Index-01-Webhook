import { pgTable, text, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";

// Separate from understanding_jobs: original per-message extraction is unchanged.
export const reviewRulesTable = pgTable("review_rules", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  trigger: text("trigger").notNull(),
  quietMinutes: integer("quiet_minutes").notNull(),
  intervalHours: integer("interval_hours").notNull(),
  dailyTime: text("daily_time").notNull(),
  timezone: text("timezone").notNull(),
  lookbackHours: integer("lookback_hours").notNull(),
  includeMessages: boolean("include_messages").notNull(),
  includeTasks: boolean("include_tasks").notNull(),
  inputRuleIds: jsonb("input_rule_ids").$type<string[]>().notNull().default([]),
  output: text("output").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  batchCursor: timestamp("batch_cursor", { withTimezone: true }).notNull().defaultNow(),
  overview: text("overview").notNull().default(""),
  overviewUpdatedAt: timestamp("overview_updated_at", { withTimezone: true }),
}, t => [index("review_rules_owner_idx").on(t.ownerId)]);

export type ReviewEffect = {
  taskId: string;
  before: { title: string; dueAt: string | null; status: string; editedAt: string | null };
  after: { title: string; dueAt: string | null; status: string; editedAt: string | null };
};
export type ReviewSource = { kind: "message" | "task" | "review"; id: string; label: string };
export const reviewRunsTable = pgTable("review_runs", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id").notNull().references(() => reviewRulesTable.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  ruleRevision: integer("rule_revision").notNull(),
  status: text("status").notNull().default("pending"),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  leaseId: text("lease_id"),
  report: text("report"),
  error: text("error"),
  sources: jsonb("sources").$type<ReviewSource[]>().notNull().default([]),
  effects: jsonb("effects").$type<ReviewEffect[]>().notNull().default([]),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
}, t => [index("review_runs_rule_idx").on(t.ruleId, t.createdAt), index("review_runs_queue_idx").on(t.status, t.availableAt)]);
