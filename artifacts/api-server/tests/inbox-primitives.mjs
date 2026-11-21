import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "inbox-primitives-"));
try {
  const output = join(dir, "checks.cjs");
  await build({
    stdin: { resolveDir: resolve("."), loader: "ts", contents: `
      import "./artifacts/ring-inbox/tests/action-order.test.mjs";
      import "./artifacts/ring-inbox/tests/task-deletion.test.mjs";
      import assert from "node:assert/strict";
      import { test } from "node:test";
      import { compareTasks, matchesTask, tasksForMessage, refreshInbox } from "./lib/api-client-react/src/inbox-primitives";
      import { compareTasks as mobileOrder } from "./artifacts/index-mobile/lib/task-order";
      import { compareActionItems as webOrder } from "./artifacts/ring-inbox/src/lib/action-order";
      test("both clients use the same ordering and source relationships", () => {
        assert.equal(webOrder, compareTasks); assert.equal(mobileOrder, compareTasks);
        const row = (id, pinnedAt, dueAt=null) => ({id, pinnedAt, dueAt, createdAt:"2026-01-01T00:00:00Z",sourceEventId:"source", status:"open"});
        const rows = [row("due",null,"2026-01-01T00:00:00Z"),row("pin","2026-01-02T00:00:00Z"),row("new-pin","2026-01-03T00:00:00Z"), {...row("elsewhere",null),sourceEventId:"other"}];
        assert.deepEqual(tasksForMessage(rows,"source").map(i=>i.id), ["new-pin","pin","due"]);
        assert.equal(matchesTask(rows[0],"open","scheduled"),true);
        assert.equal(matchesTask(rows[0],"open","unscheduled"),false);
        assert.equal(matchesTask({...rows[0],status:"completed"},"open","all"),false);
      });
      test("shared SSE refresh covers lists and details but not unrelated caches", async () => {
        let predicate;
        await refreshInbox({invalidateQueries: async options => {predicate=options.predicate;}});
        for (const key of ["/api/events","/api/events/abc","/api/events/abc/audio","/api/organizer","/api/settings","/api/webhooks"]) assert.equal(predicate({queryKey:[key]}), true,key);
        for (const key of ["/unrelated","/api/events-other",{}]) assert.equal(predicate({queryKey:[key]}), false);
      });
    ` },
    outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
  });
  await import(output);
} finally {
  await rm(dir, { recursive: true, force: true });
}
