import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeEvents, prioritizeEvents } from "../src/lib/feed-order.ts";

const events = [
  { id: "newest", receivedAt: "2026-11-15T19:00:00Z" },
  { id: "queued", receivedAt: "2026-11-15T18:00:00Z" },
  { id: "old-processing", receivedAt: "2026-11-14T18:00:00Z" },
];
test("processing pins above queued and recent messages", () => {
  assert.deepEqual(prioritizeEvents(events, [{ eventId: "queued", status: "pending" }, { eventId: "old-processing", status: "processing" }], new Set()).map(e => e.id), ["old-processing", "queued", "newest"]);
});
test("completed/failed notes return to chronological position", () => {
  for (const status of ["completed", "failed"]) {
    assert.deepEqual(prioritizeEvents(events, [{ eventId: "old-processing", status }], new Set()).map(e => e.id), events.map(e => e.id));
  }
});
test("local retry pins while awaiting server state", () => {
  assert.equal(prioritizeEvents(events, [], new Set(["old-processing"]))[0].id, "old-processing");
});
test("refresh preserves notes displaced from the head without duplicates", () => {
  const merged = mergeEvents(events, [{ id: "newer", receivedAt: "2026-11-15T20:00:00Z" }, { ...events[0], updated: true }]);
  assert.equal(merged.length, 4);
  assert.equal(merged[0].id, "newer");
  assert.equal(merged[1].updated, true);
  assert.equal(merged.at(-1).id, "old-processing");
});
test("a source with several children still occupies only one feed position", () => {
  const source = {id:"one-original",receivedAt:"2026-11-16T12:00:00Z"};
  assert.equal(mergeEvents([source],Array.from({length:4},()=>source)).length,1);
});
