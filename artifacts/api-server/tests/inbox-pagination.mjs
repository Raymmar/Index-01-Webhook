// Real route + PostgreSQL check; all data lives in a temporary isolated schema.
// NODE_ENV=production node artifacts/api-server/tests/inbox-pagination.mjs
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const temp = await mkdtemp(join(tmpdir(), "inbox-pages-"));
const schemaName = `test_pages_${randomUUID().replaceAll("-", "")}`;
const pg = createRequire(resolve("lib/db/package.json"))("pg");
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  for (const table of ["webhooks", "inbox_events", "active_actions"]) {
    await admin.query(`CREATE TABLE ${schemaName}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  const outfile = join(temp, "check.cjs");
  await build({
    stdin: {
      contents: `
        import assert from "node:assert/strict";
        import express from "express";
        import inbox from "./src/routes/inbox";
        import { db, pool, eventsTable } from "@workspace/db";
        export async function check() {
          const app = express();
          app.use("/api", inbox);
          const server = app.listen(0, "127.0.0.1");
          await new Promise(resolve => server.once("listening", resolve));
          const base = "http://127.0.0.1:" + server.address().port + "/api/events";
          const api = (query = "", owner = "owner") => fetch(base + query, {headers: {"x-test-owner": owner}});
          const page = async query => {
            const response = await api(query);
            assert.equal(response.status, 200);
            return response.json();
          };
          try {
            assert.equal((await api("", "")).status, 401);
            assert.deepEqual(await page("?pageSize=20"), {items: [], nextCursor: null});
            for (const value of ["0", "-1", "51", "1.5", "abc", "", "Infinity"]) {
              assert.equal((await api("?pageSize=" + value)).status, 400, value);
            }
            for (const value of ["bad", "no-date|id", "2026-11-15T00:00:00Z"]) {
              assert.equal((await api("?before=" + encodeURIComponent(value))).status, 400);
            }
            const make = (n, ownerId = "owner") => ({
              id: ownerId + "-" + String(n).padStart(4, "0"), ownerId, kind: "json",
              receivedAt: new Date("2026-11-15T19:00:00.000Z"), payload: {},
            });
            await db.insert(eventsTable).values(Array.from({length: 20}, (_, n) => make(n)));
            let p = await page("?pageSize=20");
            assert.equal(p.items.length, 20);
            assert.equal(p.nextCursor, null);
            await db.insert(eventsTable).values(make(20));
            p = await page("?pageSize=20");
            assert.equal(p.items.length, 20);
            assert.ok(p.nextCursor);
            let tail = await page("?pageSize=20&before=" + encodeURIComponent(p.nextCursor));
            assert.equal(tail.items.length, 1);
            assert.equal(tail.nextCursor, null);
            await db.insert(eventsTable).values([
              ...Array.from({length: 64}, (_, n) => make(n + 21)),
              ...Array.from({length: 25}, (_, n) => make(n, "other")),
            ]);
            const seen = [];
            let before;
            do {
              p = await page("?pageSize=20" + (before ? "&before=" + encodeURIComponent(before) : ""));
              assert.ok(p.items.length <= 20);
              seen.push(...p.items.map(e => e.id));
              before = p.nextCursor;
            } while (before);
            assert.equal(seen.length, 85);
            assert.equal(new Set(seen).size, 85);
            assert.deepEqual(seen, Array.from({length: 85}, (_, n) => make(84 - n).id));
            assert.equal((await page("")).items.length, 50);
            assert.equal((await page("?view=notes")).items.length, 50);
            assert.equal((await page("?pageSize=1")).items.length, 1);
            const other = await (await api("?pageSize=20", "other")).json();
            assert.equal(other.items.length, 20);
            assert.ok(other.items.every(e => e.id.startsWith("other-")));
            const ownerPage = await page("?pageSize=20");
            const foreignCursor = await (await api("?pageSize=20&before=" + encodeURIComponent(ownerPage.nextCursor), "other")).json();
            assert.ok(foreignCursor.items.every(e => e.id.startsWith("other-")));
            // Manual source notes use PostgreSQL now(), which includes micros.
            // Put 25 distinct timestamps in one millisecond to expose truncation.
            for (let n = 0; n < 25; n++) {
              await pool.query("INSERT INTO inbox_events (id, owner_id, kind, payload, received_at) VALUES ($1, 'micros', 'json', '{}', $2)",
                ["micro-" + n, "2026-11-15T19:00:00.123" + String(n).padStart(3, "0") + "Z"]);
            }
            let microCursor, microIds = [];
            do {
              const response = await api("?pageSize=20" + (microCursor ? "&before=" + encodeURIComponent(microCursor) : ""), "micros");
              assert.equal(response.status, 200);
              const result = await response.json();
              microIds.push(...result.items.map(e => e.id));
              microCursor = result.nextCursor;
            } while (microCursor);
            assert.equal(microIds.length, 25);
            assert.equal(new Set(microIds).size, 25);
            console.log("PASS: empty/20/21/multiple pages, timestamp ties/micros, bounds, cursors, ownership, unchanged default/Notes");
          } finally {
            await new Promise(resolve => server.close(resolve));
            await pool.end();
          }
        }
      `,
      resolveDir: resolve("artifacts/api-server"),
      loader: "ts",
    },
    outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    external: ["pg-native"],
    plugins: [{
      name: "isolated-pagination-check",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture-db" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture-db" }, () => ({
          resolveDir: resolve("lib/db"),
          contents: `import pg from "pg"; import {drizzle} from "drizzle-orm/node-postgres"; import * as schema from "./src/schema"; export * from "./src/schema"; export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL, options:"-c search_path=${schemaName}"}); export const db=drizzle(pool,{schema});`,
        }));
        builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "identity", namespace: "fixture-auth" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture-auth" }, () => ({
          contents: 'export const getAuth = req => ({ userId: req.headers["x-test-owner"] || null });',
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
