import { test } from "node:test";
import assert from "node:assert/strict";
import { newArrivalIds } from "../src/lib/feed-arrivals.ts";

const events = (...ids) => ids.map(id => ({ id }));

test("initial history and the first nonempty load are not arrivals", () => {
  assert.deepEqual(newArrivalIds([], events("b", "a")), []);
  assert.deepEqual(newArrivalIds([], []), []);
});

test("head catch-up counts each new id once, including timestamp ties", () => {
  assert.deepEqual(newArrivalIds(events("c", "b"), events("f", "e", "d", "c", "b")), ["f", "e", "d"]);
  assert.deepEqual(newArrivalIds(events("f", "e", "d", "c", "b"), events("f", "e", "d", "c", "b")), []);
});

test("older pagination and record updates do not count", () => {
  assert.deepEqual(newArrivalIds(events("c", "b"), events("c", "b", "a")), []);
  assert.deepEqual(newArrivalIds(events("c", "b"), [{ id: "c", changed: true }, { id: "b" }]), []);
});

test("a concurrent head refresh and older page count only the new head", () => {
  assert.deepEqual(newArrivalIds(events("c", "b"), events("e", "d", "c", "b", "a")), ["e", "d"]);
});
