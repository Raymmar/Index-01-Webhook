// Real organizer routes and PostgreSQL; isolated schema/identity, no AI calls.
// Run from workspace root: node artifacts/api-server/tests/task-paragraphs.mjs
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const pg = createRequire(resolve("lib/db/package.json"))("pg");
const schemaName = `test_paragraphs_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const temp = await mkdtemp(join(tmpdir(), "task-paragraphs-"));
try {
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  for (const table of ["webhooks", "app_settings", "user_preferences", "inbox_events", "understanding_jobs", "active_actions"]) {
    await admin.query(`CREATE TABLE ${schemaName}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  const outfile = join(temp, "check.cjs");
  await build({
    stdin: { resolveDir: resolve("artifacts/api-server"), loader: "ts", contents: `
import assert from "node:assert/strict";
import express from "express";
import { pool, db, actionsTable, eventsTable, jobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { compareTasks } from "../index-mobile/lib/task-order";
import organizer from "./src/routes/organizer";
import inbox from "./src/routes/inbox";
import { processNextJob } from "./src/lib/understanding-worker";
export async function check() {
  const app = express();
  app.use(express.json());
  app.use("/api", organizer);
  app.use("/api", inbox);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const api = (path, method = "GET", data, owner = "paragraph-test-owner") => fetch("http://127.0.0.1:" + server.address().port + "/api" + path, {
    method, headers: { "content-type": "application/json", "x-test-owner": owner },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  try {
    assert.equal((await api("/settings", "PATCH", { timezone: "UTC" })).status, 200);
    const paragraphs = "First paragraph\\n\\nSecond paragraph\\nThird line";
    const response = await api("/items", "POST", { title: "  " + paragraphs + "  " });
    assert.equal(response.status, 201);
    const item = await response.json();
    assert.equal(item.title, paragraphs);
    const read = async () => (await (await api("/organizer")).json()).items.find(i => i.id === item.id).title;
    assert.equal(await read(), paragraphs);
    const edited = "Updated paragraph\\n\\n\\nLast paragraph";
    assert.equal((await (await api("/items/" + item.id, "PATCH", { title: edited })).json()).title, edited);
    assert.equal(await read(), edited);
    assert.equal((await api("/items", "POST", { title: "x".repeat(500) })).status, 201);
    assert.equal((await api("/items", "POST", { title: "x".repeat(501) })).status, 400);
    assert.equal((await api("/items/" + item.id, "PATCH", { title: "x".repeat(501) })).status, 400);
    assert.equal((await api("/items/" + item.id, "PATCH", { title: " \\n\\n " })).status, 400);
    assert.equal(await read(), edited);
    assert.equal(item.pinnedAt, null);
    await db.insert(actionsTable).values({ id: "sibling", ownerId: "paragraph-test-owner", sourceEventId: item.sourceEventId, title: "Sibling", timezone: "UTC" });
    const pin = async id => {
      const response = await api("/items/" + id + "/pin", "POST");
      assert.equal(response.status, 200);
      return response.json();
    };
    const first = await pin(item.id);
    const second = await pin("sibling");
    const third = await pin(item.id);
    assert.ok(first.pinnedAt < second.pinnedAt && second.pinnedAt < third.pinnedAt);
    assert.deepEqual([second, third].sort(compareTasks).map(i => i.id), [item.id, "sibling"]);
    const orderFixtures = [
      {...item, id:"unscheduled", pinnedAt:null, dueAt:null},
      {...item, id:"scheduled", pinnedAt:null, dueAt:"2026-01-01T00:00:00.000Z"},
      second, third,
    ];
    assert.deepEqual(orderFixtures.sort(compareTasks).map(i=>i.id),[item.id,"sibling","scheduled","unscheduled"]);
    assert.deepEqual(orderFixtures.filter(i=>!i.dueAt).sort(compareTasks).map(i=>i.id),[item.id,"sibling","unscheduled"]);
    const rapid = await Promise.all(Array.from({ length: 8 }, () => pin(item.id)));
    assert.equal(new Set(rapid.map(i => i.pinnedAt)).size, 8);
    const latestPin = rapid.map(i => i.pinnedAt).sort().at(-1);
    let fresh = (await (await api("/organizer")).json()).items;
    assert.equal(fresh.find(i => i.id === item.id).pinnedAt, latestPin);
    const patched = await (await api("/items/" + item.id, "PATCH", { title: edited, pinnedAt: null })).json();
    assert.equal(patched.pinnedAt, latestPin);
    assert.equal((await api("/items/" + item.id + "/pin", "DELETE", undefined, "other")).status, 403);
    const unpinned = await (await api("/items/" + item.id + "/pin", "DELETE")).json();
    assert.equal(unpinned.pinnedAt, null);
    for (let cycle = 0; cycle < 5; cycle++) {
      await api("/items/" + item.id + "/pin", "DELETE");
      const repinned = await pin(item.id);
      const refreshed = (await (await api("/organizer")).json()).items.find(i=>i.id===item.id);
      assert.equal(refreshed.pinnedAt, repinned.pinnedAt);
      assert.ok(refreshed.pinnedAt);
    }
    const dismissed = await (await api("/items/" + item.id, "PATCH", { status: "dismissed" })).json();
    assert.equal(dismissed.status, "dismissed");
    await api("/items/" + item.id, "PATCH", { status: "open" });
    await api("/settings", "PATCH", { allowSignups: true });
    assert.equal((await api("/items/" + item.id + "/pin", "POST", undefined, "other")).status, 404);
    assert.equal((await api("/items/" + item.id, "DELETE", undefined, "other")).status, 404);
    assert.equal((await api("/items/missing/pin", "POST")).status, 404);
    const [sourceBefore] = await db.select().from(eventsTable).where(eq(eventsTable.id, item.sourceEventId));
    assert.equal((await api("/items/" + item.id, "DELETE")).status, 204);
    assert.equal((await api("/items/" + item.id + "/pin", "POST")).status, 404);
    fresh = (await (await api("/organizer")).json()).items;
    assert.ok(!fresh.some(i => i.id === item.id));
    assert.equal(fresh.find(i => i.id === "sibling").pinnedAt, second.pinnedAt);
    const [sourceAfter] = await db.select().from(eventsTable).where(eq(eventsTable.id, item.sourceEventId));
    assert.deepEqual(sourceAfter, sourceBefore);
    const restorePath = "/items/" + item.id + "/restore";
    assert.equal((await api(restorePath, "POST", undefined, "")).status, 401);
    assert.equal((await api(restorePath, "POST", undefined, "other")).status, 404);
    assert.equal((await api("/items/missing/restore", "POST")).status, 404);
    assert.equal((await api("/items/sibling/restore", "POST")).status, 404);
    const beforeRestore = (await db.select().from(actionsTable).where(eq(actionsTable.id, item.id)))[0];
    const restoredResponse = await api(restorePath, "POST");
    assert.equal(restoredResponse.status, 200);
    const restored = await restoredResponse.json();
    const afterRestore = (await db.select().from(actionsTable).where(eq(actionsTable.id, item.id)))[0];
    assert.deepEqual({...afterRestore, removedAt:null, editedAt:null}, {...beforeRestore, removedAt:null, editedAt:null});
    assert.equal(afterRestore.removedAt, null);
    assert.equal(restored.sourceDeleted, false);
    assert.ok((await (await api("/organizer")).json()).items.some(i=>i.id===item.id));
    assert.equal((await api(restorePath, "POST")).status, 404);
    await api("/items/" + item.id, "DELETE");
    const concurrent = await Promise.all([api(restorePath,"POST"), api(restorePath,"POST")]);
    assert.deepEqual(concurrent.map(r=>r.status).sort(), [200,404]);
    await api("/items/" + item.id, "DELETE");
    await db.update(actionsTable).set({removedAt:new Date(Date.now()-16_000)}).where(eq(actionsTable.id,item.id));
    assert.equal((await api(restorePath, "POST")).status, 410);
    assert.ok(!(await (await api("/organizer")).json()).items.some(i=>i.id===item.id));
    assert.deepEqual((await db.select().from(eventsTable).where(eq(eventsTable.id,item.sourceEventId)))[0],sourceBefore);
    assert.equal((await (await api("/organizer")).json()).items.find(i=>i.id==="sibling").pinnedAt,second.pinnedAt);
    assert.equal((await api("/events/" + item.sourceEventId, "DELETE", undefined, "other")).status, 404);
    await db.insert(jobsTable).values({eventId:item.sourceEventId,ownerId:"paragraph-test-owner",status:"pending",availableAt:new Date(0)});
    assert.equal((await api("/events/" + item.sourceEventId, "DELETE")).status, 204);
    assert.equal((await db.select().from(jobsTable).where(eq(jobsTable.eventId,item.sourceEventId)))[0].status,"completed");
    globalThis.modelCalls=0;
    await processNextJob();
    assert.equal(globalThis.modelCalls,0);
    // A stale/requeued job must also stop at the pre-provider deletion check.
    await db.update(jobsTable).set({status:"pending",availableAt:new Date(0)}).where(eq(jobsTable.eventId,item.sourceEventId));
    await processNextJob();
    assert.equal(globalThis.modelCalls,0);
    assert.equal((await db.select().from(jobsTable).where(eq(jobsTable.eventId,item.sourceEventId)))[0].status,"completed");
    const deletedSource = await (await api("/events/" + item.sourceEventId)).json();
    assert.ok(deletedSource.deletedAt);
    assert.equal(deletedSource.transcription, null);
    assert.equal(deletedSource.audioUrl, null);
    assert.deepEqual(deletedSource.payload, {});
    assert.equal((await api("/events/" + item.sourceEventId + "/audio")).status, 404);
    assert.equal((await api("/events/" + item.sourceEventId + "/understand", "POST")).status, 404);
    assert.ok(!(await (await api("/events")).json()).items.some(i=>i.id===item.sourceEventId));
    const surviving = (await (await api("/organizer")).json()).items.find(i=>i.id==="sibling");
    assert.ok(surviving.sourceDeleted);
    assert.equal(surviving.title, "Sibling");
    assert.equal(surviving.pinnedAt, second.pinnedAt);
    // A deleted source stays deleted when one of its child actions is restored.
    await db.update(actionsTable).set({removedAt:new Date()}).where(eq(actionsTable.id,item.id));
    const restoredWithDeletedSource = await (await api(restorePath,"POST")).json();
    assert.equal(restoredWithDeletedSource.sourceDeleted, true);
    assert.ok((await db.select().from(eventsTable).where(eq(eventsTable.id,item.sourceEventId)))[0].deletedAt);
    console.log("PASS: owner-scoped undo, expiry, duplicate/concurrent restores, field and sibling preservation, deleted source stays deleted");
    console.log("PASS: unpin, dismiss/restore, source soft-delete redaction and derived-task preservation");
    console.log("PASS: pin/repin ordering, concurrent pin recency, fresh-read persistence, unrelated edits, ownership and sibling/source-safe deletion");
    console.log("PASS: task paragraph create/edit/fresh-read persistence, blank rejection and 500-character limit");
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
}` },
    outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent", external: ["pg-native"],
    plugins: [{ name: "isolated-task-storage", setup(builder) {
      builder.onResolve({ filter: /^\.\/understanding$/ }, () => ({ path: "understanding", namespace: "fixture" }));
      builder.onLoad({ filter: /^understanding$/, namespace: "fixture" }, () => ({ contents: 'export async function extractActions(){globalThis.modelCalls++;throw new Error("Deleted content reached model");}' }));
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "auth", namespace: "fixture" }));
      builder.onLoad({ filter: /^auth$/, namespace: "fixture" }, () => ({ contents: 'export const getAuth = req => ({ userId: req.headers["x-test-owner"] });' }));
      builder.onLoad({ filter: /^db$/, namespace: "fixture" }, () => ({
        resolveDir: resolve("lib/db"),
        contents: `import pg from "pg"; import {drizzle} from "drizzle-orm/node-postgres"; import * as schema from "./src/schema"; export * from "./src/schema"; export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,options:"-c search_path=${schemaName}"}); export const db = drizzle(pool,{schema});`,
      }));
    } }],
  });
  await createRequire(import.meta.url)(outfile).check();
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
  await rm(temp, { recursive: true, force: true });
}
