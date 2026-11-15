// Isolated-schema integration regression: uses real PostgreSQL, real routes,
// and one real managed-AI extraction. No existing user data is changed.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const pg = createRequire(resolve("lib/db/package.json"))("pg");

const schemaName = `test_organizer_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const temp = await mkdtemp(join(tmpdir(), "organizer-"));
try {
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  for (const table of ["webhooks", "inbox_events", "app_settings", "user_preferences", "understanding_jobs", "action_items"]) {
    await admin.query(`CREATE TABLE ${schemaName}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  const outfile = join(temp, "check.cjs");
  await build({
    stdin: {
      contents: `
import assert from "node:assert/strict";
import express from "express";
import { db, pool, appSettingsTable, eventsTable, jobsTable, itemsTable } from "@workspace/db";
import organizer from "./src/routes/organizer";
import inbox from "./src/routes/inbox";
import receive from "./src/routes/receive";
import { accountFor } from "./src/lib/account";
import { processNextJob } from "./src/lib/understanding-worker";
import { resolveDue } from "./src/lib/understanding";
import { processingFailure } from "./src/lib/ai-models";
import { eq } from "drizzle-orm";
export async function check() {
  const app = express();
  app.use((req, _res, next) => { req.log = { warn() {} }; next(); });
  app.use("/api", receive);
  app.use(express.json());
  app.use("/api", organizer);
  app.use("/api", inbox);
  app.use((err, _req, res, _next) => { console.error(err.name); res.status(500).end(); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const api = (path, method = "GET", identity = "owner", data) => fetch(base + path, {
    method, headers: { "x-test-owner": identity, "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  try {
    assert.equal((await api("/settings", "GET", "")).status, 401);
    const [a,b] = await Promise.all([accountFor("owner"), accountFor("other")]);
    const [config] = await db.select().from(appSettingsTable);
    assert.ok(["owner", "other"].includes(config.ownerId));
    assert.equal((await db.select().from(appSettingsTable)).length, 1);
    // Set isolated fixture identity so subsequent checks are deterministic.
    await db.update(appSettingsTable).set({ ownerId: "owner" });
    assert.equal((await (await api("/settings")).json()).isOwner, true);
    assert.ok((await (await api("/settings")).json()).availableModels.includes("gpt-5.6-terra"));
    assert.equal((await api("/settings", "PATCH", "owner", { aiModel: "gpt-5.6" })).status, 400);
    assert.equal((await (await api("/settings")).json()).aiModel, "gpt-5-mini");
    assert.equal(processingFailure({ status: 400, code: "UNSUPPORTED_MODEL", message: "private content" }).retry, false);
    assert.ok(!processingFailure({ status: 400, code: "UNSUPPORTED_MODEL", message: "private content" }).message.includes("private content"));
    assert.equal(processingFailure({ status: 429 }).retry, true);
    assert.equal((await (await api("/settings", "GET", "other")).json()).allowed, false);
    assert.equal((await api("/events", "GET", "other")).status, 403);
    assert.equal((await api("/settings", "PATCH", "owner", { timezone: "Invalid/Zone" })).status, 400);
    assert.equal((await api("/settings", "PATCH", "owner", { timezone: "America/Los_Angeles", allowSignups: true })).status, 200);
    assert.equal((await (await api("/settings", "GET", "other")).json()).allowed, true);
    assert.equal((await api("/settings", "PATCH", "other", { allowSignups: false })).status, 403);
    assert.equal((await api("/settings", "PATCH", "other", { timezone: "Europe/London" })).status, 200);
    const created = await api("/webhooks", "POST", "owner", { name: "AI fixture" });
    assert.equal(created.status, 201);
    const hook = await created.json();
    const delivery = await fetch(base + hook.webhook.path.slice(4), {
      method: "POST", headers: { "content-type": "application/json", authorization: hook.headerValue },
      body: JSON.stringify({ recordedAt: Date.parse("2026-11-15T16:58:00Z"),
        transcription: "Add update the landing page to my task list. Also add buy printer paper to my task list. Remind me in 30 minutes to call Sam. Remind me tomorrow at 9 AM to send the report. Remind me tomorrow to check the plants. My idea is that an annual plan might be useful." }),
    });
    assert.equal(delivery.status, 201);
    const receipt = await delivery.json();
    await db.update(eventsTable).set({ receivedAt: new Date("2026-11-15T16:58:00Z") }).where(eq(eventsTable.id, receipt.id));
    assert.equal((await api("/events/" + receipt.id + "/understand", "POST", "other")).status, 404);
    await Promise.all([processNextJob(), processNextJob()]);
    let data = await (await api("/organizer")).json();
    assert.equal(data.messageCount, 1);
    const job = data.jobs.find(j => j.eventId === receipt.id);
    assert.equal(job.status, "completed", JSON.stringify(job));
    const items = data.items.filter(i => i.sourceEventId === receipt.id);
    assert.equal(items.filter(i => i.kind === "task").length, 2);
    assert.equal(items.filter(i => i.kind === "reminder").length, 3);
    assert.ok(items.some(i => i.dueAt === "2026-11-15T17:28:00.000Z"));
    assert.ok(items.some(i => i.dueAt === "2026-11-16T17:00:00.000Z"));
    assert.ok(items.some(i => i.title.toLowerCase().includes("plants") && i.dueAt === "2026-11-16T16:58:00.000Z" && !i.needsReview));
    assert.equal((await db.select().from(eventsTable)).length, 1);
    await api("/events/" + receipt.id + "/understand", "POST");
    await processNextJob();
    assert.equal((await db.select().from(itemsTable)).length, items.length);
    const target = items[0];
    assert.equal((await api("/items/" + target.id, "PATCH", "other", { title: "Wrong owner" })).status, 404);
    assert.equal((await api("/items/" + target.id, "DELETE", "other")).status, 404);
    assert.equal((await (await api("/organizer", "GET", "other")).json()).items.length, 0);
    assert.equal((await (await api("/organizer", "GET", "other")).json()).messageCount, 0);
    assert.equal((await api("/items/" + target.id, "PATCH", "owner", { title: "Changed", status: "completed" })).status, 200);
    assert.equal((await api("/items/" + target.id, "PATCH", "owner", { status: "open" })).status, 200);
    assert.equal((await api("/items/" + target.id, "DELETE")).status, 204);
    assert.equal((await db.select().from(eventsTable)).length, 1);
    assert.equal((await api("/items", "POST", "owner", { kind: "reminder", title: "Manual", dueAt: "2026-11-20T09:00:00Z" })).status, 201);
    assert.equal((await api("/items", "POST", "owner", { kind: "reminder", title: "Bad", dueAt: "2026-11-20T09:00" })).status, 400);
    const ambiguous = { kind: "reminder", title: "DST", localDueAt: "2027-03-14T02:30", minutesFromRecording: null, originalTimeText: "2:30", needsReview: false };
    assert.equal(resolveDue(ambiguous, new Date(), "America/Los_Angeles").needsReview, true);
    // Notes are original events, filtered before pagination; unfinished jobs
    // and messages with linked actions must not be classified as plain notes.
    const [original] = await db.select().from(eventsTable).where(eq(eventsTable.id, receipt.id));
    const noteFixtures = Array.from({length: 54}, (_, index) => ({
      ...original, id: "plain-note-" + index,
      transcription: index === 53 ? "   " : "A thought to keep.",
      receivedAt: new Date(Date.parse("2026-11-01T12:00:00Z") + index * 1000),
    }));
    await db.insert(eventsTable).values(noteFixtures);
    await db.insert(jobsTable).values(noteFixtures.map((event, index) => ({
      eventId: event.id, ownerId: "owner",
      status: index === 0 ? "pending" : index === 1 ? "failed" : "completed",
    })));
    const notesPage = await (await api("/events?view=notes")).json();
    assert.equal(notesPage.items.length, 50);
    assert.ok(notesPage.nextCursor);
    assert.ok(notesPage.items.every(event => event.id.startsWith("plain-note-") && !["plain-note-0", "plain-note-1", "plain-note-53"].includes(event.id)));
    const olderNotes = await (await api("/events?view=notes&before=" + encodeURIComponent(notesPage.nextCursor))).json();
    assert.equal(olderNotes.items.length, 1);
    assert.equal(olderNotes.nextCursor, null);
    assert.equal(new Set([...notesPage.items, ...olderNotes.items].map(e => e.id)).size, 51);
    assert.equal((await (await api("/events?view=notes", "GET", "other")).json()).items.length, 0);
    assert.equal((await api("/events?view=invalid")).status, 400);
    console.log("PASS: notes classification, original-event retention, pagination and account isolation");
    ambiguous.localDueAt = "2026-11-01T01:30";
    assert.equal(resolveDue(ambiguous, new Date(), "America/Los_Angeles").needsReview, true);
    await api("/settings", "PATCH", "owner", { allowSignups: false });
    assert.equal((await api("/organizer", "GET", "other")).status, 403);
    console.log("PASS: atomic first owner, access toggle, per-user timezone and owner-only settings");
    console.log("PASS: real AI extracted two tasks, three reminders; UTC/relative/ambiguous time handling");
    console.log("PASS: concurrent workers and repeated processing do not duplicate items or notes");
    console.log("PASS: cross-account isolation, CRUD/undo, original note retention, DST validation");
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
}
`,
      resolveDir: resolve("artifacts/api-server"), loader: "ts",
    },
    outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent", external: ["pg-native"],
    plugins: [{
      name: "isolated-db-and-identity",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
        builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "auth", namespace: "fixture" }));
        builder.onLoad({ filter: /auth/, namespace: "fixture" }, () => ({ contents: 'export const getAuth = req => ({ userId: req.headers["x-test-owner"] || null });' }));
        builder.onLoad({ filter: /db/, namespace: "fixture" }, () => ({
          resolveDir: resolve("lib/db"),
          contents: `import pg from "pg"; import {drizzle} from "drizzle-orm/node-postgres"; import * as schema from "./src/schema"; export * from "./src/schema"; export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL, options:"-c search_path=${schemaName}"}); export const db=drizzle(pool,{schema});`,
        }));
      },
    }],
  });
  await createRequire(import.meta.url)(outfile).check();
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
  await rm(temp, { recursive: true, force: true });
}
