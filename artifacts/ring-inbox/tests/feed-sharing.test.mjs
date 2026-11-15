import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { shareFeedPage } from "../src/lib/feed-sharing.ts";

const event = n => ({ id: String(n), receivedAt: "2026-11-15T12:00:00Z", payload: { sequence: n }, transcription: `Note ${n}` });

test("prepending keeps every unchanged note's identity, including freshly decoded JSON", () => {
  const old = { items: Array.from({ length: 2000 }, (_, n) => event(n)), nextCursor: "older" };
  const next = shareFeedPage(old, { items: [event(-1), ...structuredClone(old.items)], nextCursor: "older" });
  assert.equal(next.items.length, 2001);
  old.items.forEach((item, n) => assert.equal(next.items[n + 1], item));
  assert.equal(next.nextCursor, "older");
});

test("changed fields invalidate just that card and removed fields are not retained", () => {
  const old = { items: [event(1), event(2)], nextCursor: "older" };
  const changed = { ...event(2), transcription: "Updated", payload: null };
  const next = shareFeedPage(old, { items: [changed, event(1)], nextCursor: null });
  assert.notEqual(next.items[0], old.items[1]);
  assert.equal(next.items[0].transcription, "Updated");
  assert.equal(next.items[0].payload, null);
  assert.equal(next.items[1], old.items[0]);
  assert.equal(next.nextCursor, null);
});

test("history append, empty history and first response preserve server boundaries", () => {
  const initial = { items: [event(1)], nextCursor: "cursor" };
  assert.equal(shareFeedPage(undefined, initial), initial);
  const appended = shareFeedPage(initial, { items: [event(1), event(2)], nextCursor: null });
  assert.equal(appended.items[0], initial.items[0]);
  assert.equal(appended.items.length, 2);
  assert.deepEqual(shareFeedPage(appended, { items: [], nextCursor: null }), { items: [], nextCursor: null });
});

test("QueryClient uses identity sharing instead of cloning shifted arrays", () => {
  const client = new QueryClient();
  const key = ["performance-test"];
  client.setQueryDefaults(key, { structuralSharing: shareFeedPage });
  client.setQueryData(key, { items: [event(1), event(2)], nextCursor: null });
  const old = client.getQueryData(key);
  client.setQueryData(key, { items: [event(0), event(1), event(2)], nextCursor: null });
  assert.equal(client.getQueryData(key).items[1], old.items[0]);
  assert.equal(client.getQueryData(key).items[2], old.items[1]);
  client.clear();
});
