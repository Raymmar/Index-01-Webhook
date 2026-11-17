import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskDeletion, TASK_UNDO_MS } from "../src/lib/task-deletion.ts";

function setup() {
  let now = 1000, changed = 0, failDelete = false, restoreError;
  const removed = [], restored = [];
  const deletion = new TaskDeletion({
    now: () => now,
    remove: async id => { removed.push(id); if (failDelete) throw Error("delete failed"); },
    restore: async id => { restored.push(id); if (restoreError) throw restoreError; },
    changed: () => changed++,
  });
  return {
    deletion, removed, restored, get changed() { return changed; },
    advance: ms => { now += ms; },
    failDelete: () => { failDelete = true; },
    restoreError: value => { restoreError = value; },
  };
}
const task = id => ({ id, title: `Task ${id}` });

test("deletion targets only the exact task and consecutive notices remain independent", async () => {
  const s = setup();
  await s.deletion.remove(task("one")); await s.deletion.remove(task("two"));
  assert.deepEqual(s.removed, ["one", "two"]);
  assert.equal(s.deletion.notices.length, 2);
  await s.deletion.undo("one");
  assert.deepEqual(s.restored, ["one"]);
  assert.deepEqual(s.deletion.notices.map(n => n.id), ["two"]);
  assert.equal(s.changed, 3);
});
test("failed deletion creates no misleading Undo notice", async () => {
  const s = setup(); s.failDelete();
  await assert.rejects(s.deletion.remove(task("one")));
  assert.deepEqual(s.deletion.notices, []);
  assert.equal(s.changed, 1);
});
test("local expiry is strict at the deadline, even before the timer catches up", async () => {
  const s = setup(); await s.deletion.remove(task("one"));
  s.advance(TASK_UNDO_MS); await s.deletion.undo("one");
  assert.deepEqual(s.deletion.notices, []);
  assert.deepEqual(s.restored, []);
});
test("transient restore failure allows retry without extending expiry", async () => {
  const s = setup(); await s.deletion.remove(task("one"));
  const deadline = s.deletion.notices[0].expiresAt;
  s.restoreError({ status: 500 }); await s.deletion.undo("one");
  assert.equal(s.deletion.notices[0].state, "ready");
  assert.match(s.deletion.notices[0].error, /Try Undo again/);
  assert.equal(s.deletion.notices[0].expiresAt, deadline);
  s.restoreError(undefined); await s.deletion.undo("one");
  assert.deepEqual(s.deletion.notices, []);
});
for (const status of [404, 410]) test(`server ${status} permanently disables Undo`, async () => {
  const s = setup(); await s.deletion.remove(task("one")); s.restoreError({ status });
  await s.deletion.undo("one"); await s.deletion.undo("one");
  assert.deepEqual(s.deletion.notices, []);
  assert.equal(s.restored.length, 1);
});
test("duplicate delete and restore clicks send one request while pending", async () => {
  let release, deletes = 0, restores = 0;
  const deletion = new TaskDeletion({
    remove: () => { deletes++; return new Promise(resolve => { release = resolve; }); },
    restore: () => { restores++; return new Promise(resolve => { release = resolve; }); },
    changed() {},
  });
  const removing = deletion.remove(task("one")); await deletion.remove(task("one"));
  assert.equal(deletes, 1); release(); await removing;
  const restoring = deletion.undo("one"); await deletion.undo("one");
  deletion.dismiss("one");
  assert.equal(deletion.notices[0].state, "restoring");
  assert.equal(restores, 1); release(); await restoring;
});
test("slow deletion response cannot extend the server deadline", async () => {
  let now = 0;
  const deletion = new TaskDeletion({
    now: () => now, remove: async () => { now = TASK_UNDO_MS; },
    restore: async () => assert.fail("must not restore"), changed() {},
  });
  await deletion.remove(task("one"));
  assert.deepEqual(deletion.notices, []);
});
test("expiry publishes state and closing a notice never changes server data", async () => {
  const s = setup(); let updates = 0;
  const unsubscribe = s.deletion.subscribe(() => updates++);
  await s.deletion.remove(task("one")); s.advance(TASK_UNDO_MS); s.deletion.expire();
  assert.deepEqual(s.deletion.snapshot(), []);
  s.deletion.dismiss("one"); unsubscribe();
  assert.equal(updates, 3);
  assert.deepEqual(s.deletion.snapshot(), []);
  assert.deepEqual(s.removed, ["one"]); assert.deepEqual(s.restored, []);
});
