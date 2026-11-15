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
  for (const table of ["app_settings", "user_preferences", "inbox_events", "understanding_jobs", "active_actions"]) {
    await admin.query(`CREATE TABLE ${schemaName}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  const outfile = join(temp, "check.cjs");
  await build({
    stdin: { resolveDir: resolve("artifacts/api-server"), loader: "ts", contents: `
import assert from "node:assert/strict";
import express from "express";
import { pool } from "@workspace/db";
import organizer from "./src/routes/organizer";
export async function check() {
  const app = express();
  app.use(express.json());
  app.use("/api", organizer);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const api = (path, method = "GET", data) => fetch("http://127.0.0.1:" + server.address().port + "/api" + path, {
    method, headers: { "content-type": "application/json" },
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
    console.log("PASS: task paragraph create/edit/fresh-read persistence, blank rejection and 500-character limit");
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
}` },
    outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent", external: ["pg-native"],
    plugins: [{ name: "isolated-task-storage", setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "auth", namespace: "fixture" }));
      builder.onLoad({ filter: /^auth$/, namespace: "fixture" }, () => ({ contents: 'export const getAuth = () => ({ userId: "paragraph-test-owner" });' }));
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
