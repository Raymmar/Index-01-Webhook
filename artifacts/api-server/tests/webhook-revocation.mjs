// Real route/database regression check. Run with:
// NODE_ENV=production node artifacts/api-server/tests/webhook-revocation.mjs
// Clerk identity is stubbed only in this isolated loopback test server.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const temp = await mkdtemp(join(tmpdir(), "ring-revocation-"));
const schemaName = `test_revoke_${randomUUID().replaceAll("-", "")}`;
const pg = createRequire(resolve("lib/db/package.json"))("pg");
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  for (const table of ["webhooks", "inbox_events", "app_settings", "user_preferences", "understanding_jobs", "action_items", "active_actions", "message_outbox"]) {
    await admin.query(`CREATE TABLE ${schemaName}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  const outfile = join(temp, "check.cjs");
  await build({
    stdin: {
      contents: `
        import assert from "node:assert/strict";
        import { randomUUID } from "node:crypto";
        import { request } from "node:http";
        import express from "express";
        import inbox from "./src/routes/inbox";
        import receive from "./src/routes/receive";
        import { db, pool, eventsTable, webhooksTable } from "@workspace/db";
        import { eq, inArray } from "drizzle-orm";

        export async function check() {
          const owner = "revocation-check-" + randomUUID();
          const ids = [];
          const app = express();
          app.use((req, _res, next) => { req.log = { warn() {} }; next(); });
          // Mirror production mount order: webhook auth before Clerk/body parser.
          app.use("/api", receive);
          app.use(express.json());
          app.use("/api", inbox);
          app.use((error, _req, res, _next) => { res.status(500).json({ error: error.message }); });
          const server = app.listen(0, "127.0.0.1");
          await new Promise((resolve) => server.once("listening", resolve));
          const port = server.address().port;
          const base = "http://127.0.0.1:" + port + "/api";
          const api = (path, method = "GET", identity = owner, data) => fetch(base + path, {
            method, headers: { "x-test-owner": identity, "content-type": "application/json" },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
          });
          const deliver = (hook, data) => fetch(base + hook.webhook.path.slice(4), {
            method: "POST", headers: { authorization: hook.headerValue, "content-type": "application/json" },
            body: JSON.stringify(data),
          });
          try {
            const created = await api("/webhooks", "POST", owner, { name: "Revocation regression" });
            assert.equal(created.status, 201);
            const hook = await created.json();
            const id = hook.webhook.id;
            ids.push(id);
            assert.equal((await deliver(hook, { transcription: "Retain this test transcript" })).status, 201);
            const before = (await (await api("/events")).json()).items.filter(e => e.webhookId === id);
            assert.equal(before.length, 1);
            assert.equal((await api("/webhooks/" + id, "DELETE", "")).status, 401);
            assert.equal((await api("/webhooks/" + id, "DELETE", owner + "-other")).status, 404);
            assert.equal((await api("/webhooks")).status, 200);
            assert.equal((await (await api("/webhooks")).json()).some(w => w.id === id), true);

            // Start a delivery whose JSON body is still arriving when revoked.
            const delayed = request({
              hostname: "127.0.0.1", port, path: hook.webhook.path, method: "POST",
              headers: { authorization: hook.headerValue, "content-type": "application/json" },
            });
            const delayedStatus = new Promise((resolve, reject) => {
              delayed.on("response", res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
              delayed.on("error", reject);
            });
            delayed.write('{"transcription":');
            await new Promise(resolve => setTimeout(resolve, 250));
            assert.equal((await api("/webhooks/" + id, "DELETE")).status, 204);
            delayed.end('"Must not be saved"}');
            assert.equal(await delayedStatus, 401);
            assert.equal((await deliver(hook, { transcription: "Must not be saved either" })).status, 401);
            assert.equal((await api("/webhooks/" + id + "/rotate", "POST")).status, 404);
            assert.equal((await (await api("/webhooks")).json()).some(w => w.id === id), false);
            const after = (await (await api("/events")).json()).items.filter(e => e.webhookId === id);
            assert.deepEqual(after, before);
            assert.equal((await api("/webhooks/" + id, "DELETE")).status, 204);
            const [row] = await db.select().from(webhooksTable).where(eq(webhooksTable.id, id));
            assert.ok(row.revokedAt);
            assert.equal(row.eventCount, 1);
            console.log("PASS: signed-out/cross-account revocation rejected");
            console.log("PASS: revoked endpoint hidden; credentials and rotation rejected");
            console.log("PASS: in-flight delivery rejected after revocation");
            console.log("PASS: existing inbox event retained; repeated revoke safe");
          } finally {
            await new Promise(resolve => server.close(resolve));
            if (ids.length) {
              await db.delete(eventsTable).where(inArray(eventsTable.webhookId, ids));
              await db.delete(webhooksTable).where(inArray(webhooksTable.id, ids));
            }
            await pool.end();
          }
        }
      `,
      resolveDir: resolve("artifacts/api-server"),
      loader: "ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
    external: ["pg-native"],
    plugins: [{
      name: "isolated-test-identity",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture-db" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture-db" }, () => ({
          resolveDir: resolve("lib/db"),
          contents: `import pg from "pg"; import {drizzle} from "drizzle-orm/node-postgres"; import * as schema from "./src/schema"; export * from "./src/schema"; export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL, options:"-c search_path=${schemaName}"}); export const db=drizzle(pool,{schema});`,
        }));
        builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "identity", namespace: "test" }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
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
