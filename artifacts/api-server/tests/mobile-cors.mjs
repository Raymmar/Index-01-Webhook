import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "index-cors-"));
try {
  await build({
    stdin: { contents: 'import express from "express"; import {mobileCors} from "./src/middlewares/mobileCors"; export function start(){const app=express();app.use("/api",mobileCors);app.get("/api/check",(_req,res)=>res.json({ok:true}));return app.listen(0,"127.0.0.1");}', resolveDir: resolve("artifacts/api-server"), loader: "ts" },
    outfile: join(dir, "server.cjs"), platform: "node", format: "cjs", bundle: true, logLevel: "silent",
  });
  process.env.REPLIT_EXPO_DEV_DOMAIN = "mobile.example.test";
  process.env.REPLIT_DEV_DOMAIN = "web.example.test";
  const server = createRequire(import.meta.url)(join(dir, "server.cjs")).start();
  await new Promise(r => server.once("listening", r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/check`;
    const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: "https://mobile.example.test", "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "authorization,content-type" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://mobile.example.test");
    assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/);
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
    const external = await fetch(url, { headers: { Origin: "https://untrusted.example.test" } });
    assert.equal(external.headers.get("access-control-allow-origin"), null);
    const native = await fetch(url);
    assert.equal(native.status, 200);
    console.log("PASS: Expo preflight, no cookie credentials, untrusted origin exclusion, native requests unaffected");
  } finally { await new Promise(r => server.close(r)); }
} finally { await rm(dir, { recursive: true, force: true }); }
