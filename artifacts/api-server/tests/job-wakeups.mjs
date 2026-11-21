import { build } from 'esbuild';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temp = await mkdtemp(join(tmpdir(), 'job-wakeups-'));
try {
  const outfile = join(temp, 'worker.mjs');
  await build({ entryPoints: ['artifacts/api-server/src/lib/job-wakeups.ts'], outfile, bundle: true, platform: 'node', format: 'esm' });
  const { startJobWakeups } = await import(pathToFileURL(outfile));
  const connections = [];
  const pool = { async connect() {
    const c = new EventEmitter(); c.releases = 0;
    c.query = async () => {};
    c.release = () => { assert.equal(++c.releases, 1); c.emit('end'); };
    connections.push(c); return c;
  } };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check, ms = 2000) {
    const start = Date.now();
    while (!check()) { assert.ok(Date.now() - start < ms, 'Timed out'); await wait(10); }
  }
  let queue = [Date.now(), Date.now()];
  let completed = 0, reads = 0, active = 0, maxActive = 0;
  let gate;
  const stop = startJobWakeups({
    pool, onError() {},
    async drain() {
      reads++; maxActive = Math.max(maxActive, ++active);
      try {
        if (gate) { const g = gate; gate = null; await g(); }
        if (!queue.length || queue[0] > Date.now()) return false;
        queue.shift(); completed++; return true;
      } finally { active--; }
    },
    async nextDeadline() { return queue[0] ?? null; },
  });
  const notify = () => connections.at(-1).emit('notification', { channel: 'ring_inbox_changed' });
  try {
    await until(() => completed === 2);
    await wait(20); const idleReads = reads;
    await wait(150); assert.equal(reads, idleReads, 'Idle queue must not poll');
    const sent = Date.now(); queue.push(Date.now(), Date.now()); notify();
    await until(() => completed === 4);
    assert.ok(Date.now() - sent < 500, 'Notifications should wake immediately');
    queue.push(Date.now() + 140); notify();
    await wait(70); assert.equal(completed, 4, 'Retry must not run before its deadline');
    await until(() => completed === 5);
    let release;
    gate = () => new Promise(resolve => { release = resolve; });
    notify(); await until(() => !!release);
    queue.push(Date.now()); notify(); release();
    await until(() => completed === 6);
    assert.equal(maxActive, 1, 'Wakeups must not overlap drains');
    connections.at(-1).emit('error', new Error('disconnect'));
    queue.push(Date.now()); // No notification: startup catch-up must recover this.
    await until(() => completed === 7, 3000);
    assert.equal(connections.length, 2);
    stop(); const stoppedReads = reads;
    notify(); await wait(100);
    assert.equal(reads, stoppedReads);
    assert.equal(connections.at(-1).releases, 1);
    console.log('PASS: startup backlog, immediate wakeups, idle silence, retry deadlines, in-flight wakeups, serial draining, reconnect catch-up, clean stop');
  } finally { stop(); }
} finally { await rm(temp, { recursive: true, force: true }); }
