import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshFeed, singleFlight } from "../src/lib/feed-pagination.ts";
import { mergeEvents } from "../src/lib/feed-order.ts";

const event = n => ({ id: String(n).padStart(4, "0"), receivedAt: "2026-11-15T19:00:00.000Z" });
const events = count => Array.from({ length: count }, (_, n) => event(count - n));
function server(rows) {
  const calls = [];
  return {
    calls,
    fetch: async before => {
      calls.push(before);
      const start = before ? rows.findIndex(event => event.id === before) + 1 : 0;
      const items = rows.slice(start, start + 20);
      return { items, nextCursor: start + 20 < rows.length ? items.at(-1).id : null };
    },
  };
}

for (const count of [0, 20, 21, 85]) {
  test(`initial load for ${count} records is bounded to 20`, async () => {
    const source = server(events(count));
    const page = await refreshFeed(undefined, source.fetch);
    assert.equal(page.items.length, Math.min(count, 20));
    assert.equal(!!page.nextCursor, count > 20);
    assert.equal(source.calls.length, 1);
  });
}
test("timestamp ties and multiple pages yield every message exactly once", async () => {
  const rows = events(85);
  const source = server(rows);
  let page = await source.fetch();
  let all = page.items;
  while (page.nextCursor) {
    page = await source.fetch(page.nextCursor);
    all = mergeEvents(all, page.items);
  }
  assert.deepEqual(all, rows);
  assert.equal(source.calls.length, 5);
});
test("a large SSE burst is bridged without moving the history boundary", async () => {
  const source = server(events(120));
  const previous = { items: events(60).slice(0, 40), nextCursor: "0021" };
  const refreshed = await refreshFeed(previous, source.fetch);
  assert.deepEqual(refreshed.items, events(120).slice(0, 100));
  assert.equal(refreshed.nextCursor, previous.nextCursor);
  assert.equal(source.calls.length, 4);
});
test("exhausted history remains exhausted after a burst", async () => {
  const source = server(events(70));
  const refreshed = await refreshFeed({ items: events(20), nextCursor: null }, source.fetch);
  assert.equal(refreshed.items.length, 70);
  assert.equal(refreshed.nextCursor, null);
});
test("a previous empty feed accepts a new history cursor", async () => {
  const source = server(events(25));
  const refreshed = await refreshFeed({ items: [], nextCursor: null }, source.fetch);
  assert.equal(refreshed.items.length, 20);
  assert.equal(refreshed.nextCursor, "0006");
});
test("head overlap prevents unrelated processing jobs from traversing history", async () => {
  const source = server(events(100));
  const previous = await source.fetch();
  source.calls.length = 0;
  await refreshFeed(previous, source.fetch);
  assert.equal(source.calls.length, 1);
});
test("failed gap bridging does not publish a partial refresh", async () => {
  const previous = { items: events(20), nextCursor: null };
  let calls = 0;
  await assert.rejects(refreshFeed(previous, async () => {
    if (calls++) throw new Error("offline");
    return { items: events(80).slice(0, 20), nextCursor: "0061" };
  }), /offline/);
  assert.equal(previous.items.length, 20);
});
test("repeated cursors fail explicitly rather than loop", async () => {
  await assert.rejects(refreshFeed({ items: [event(1)], nextCursor: null },
    async () => ({ items: [event(4)], nextCursor: "same" })), /did not advance/);
});
test("rapid notifications share one request and failures allow explicit retry", async () => {
  const run = singleFlight();
  let calls = 0;
  let finish;
  const request = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const promises = Array.from({ length: 20 }, () => run(request));
  await Promise.resolve();
  assert.equal(calls, 1);
  finish();
  await Promise.all(promises);
  await assert.rejects(run(async () => { throw new Error("offline"); }), /offline/);
  await run(async () => { calls++; });
  assert.equal(calls, 2);
});
