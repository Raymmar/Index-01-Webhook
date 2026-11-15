import { test } from "node:test";
import assert from "node:assert/strict";
import { compareActionItems } from "../src/lib/action-order.ts";

const item = (id, dueAt, createdAt = "2026-11-15T12:00:00Z") => ({ id, dueAt, createdAt });
test("new arrivals insert by urgency, not arrival time", () => {
  const rows = [item("later", "2026-11-17T12:00:00Z"), item("undated", null), item("overdue", "2026-11-14T12:00:00Z")];
  rows.push(item("new-sooner", "2026-11-16T12:00:00Z", "2026-11-15T18:00:00Z"));
  assert.deepEqual(rows.sort(compareActionItems).map(i => i.id), ["overdue", "new-sooner", "later", "undated"]);
});
test("timestamps compare instants even with different timezone offsets", () => {
  assert.ok(compareActionItems(item("a", "2026-11-15T10:00:00-08:00"), item("b", "2026-11-15T17:00:00Z")) > 0);
});
test("equal dates and undated items have stable newest-first tie ordering", () => {
  assert.ok(compareActionItems(item("old", null), item("new", null, "2026-11-16T12:00:00Z")) > 0);
  assert.ok(compareActionItems(item("a", null), item("b", null)) < 0);
});
test("siblings retain independent urgency and identity", () => {
  const siblings = [item("a",null), item("b","2026-11-16T12:00:00Z"), item("c",null), item("d","2026-11-15T12:00:00Z")]
    .map(row => ({...row,sourceEventId:"one-original"}));
  assert.deepEqual(siblings.sort(compareActionItems).map(row=>row.id),["d","b","a","c"]);
  assert.equal(new Set(siblings.map(row=>row.sourceEventId)).size,1);
});
