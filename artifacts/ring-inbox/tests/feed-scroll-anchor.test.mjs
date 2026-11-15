import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// Exercise the real lifecycle without a browser or an authentication bypass.
// TypeScript transpiles TSX; the existing Node runner handles the small helper.
const require = createRequire(new URL("../src/components/feed-scroll-anchor.tsx", import.meta.url));
const source = readFileSync(new URL("../src/components/feed-scroll-anchor.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
new Function("require", "exports", compiled)(name =>
  require(name === "../lib/feed-arrivals" ? "../lib/feed-arrivals.ts" : name), exports);
const { FeedScrollAnchor } = exports;
const { renderToStaticMarkup } = require("react-dom/server");

function fixture(embedded, count = 6) {
  let ids = count === 6 ? ["a", "b", "c", "d", "e", "f"] : Array.from({ length: count }, (_, n) => String(n));
  let positionReads = 0;
  let scroll = 500;
  let focused;
  let listener;
  const top = embedded ? 100 : 0;
  const scroller = {
    get scrollTop() { return scroll; },
    set scrollTop(value) { scroll = value; },
    getBoundingClientRect: () => ({ top, bottom: top + 400 }),
    scrollTo: ({ top }) => { scroll = top; },
    addEventListener: (_name, fn) => { listener = fn; },
    removeEventListener: () => { listener = undefined; },
  };
  globalThis.window = {
    get scrollY() { return scroll; },
    innerHeight: 400,
    scrollBy: (_x, delta) => { scroll += delta; },
    scrollTo: ({ top }) => { scroll = top; },
    addEventListener: scroller.addEventListener,
    removeEventListener: scroller.removeEventListener,
  };
  const cards = new Map();
  const card = id => {
    if (!cards.has(id)) cards.set(id, {
      dataset: { eventId: id },
      isConnected: true,
      getBoundingClientRect: () => {
        positionReads++;
        return { top: top + ids.indexOf(id) * 160 - scroll, bottom: top + (ids.indexOf(id) + 1) * 160 - scroll };
      },
      focus: () => { focused = id; },
    });
    return cards.get(id);
  };
  const props = { embedded, target: null, events: ids.map(id => ({ id })), children: "cards" };
  const component = new FeedScrollAnchor(props);
  component.root.current = {
    closest: () => scroller,
    getElementsByTagName: () => ids.map(card),
    querySelectorAll: () => ids.map(card),
    focus: () => { focused = "feed"; },
  };
  // Synchronous state is sufficient here: lifecycle snapshots are invoked by
  // update() at the same before/after DOM boundaries as a React commit.
  component.setState = update => {
    component.state = { ...component.state, ...(typeof update === "function" ? update(component.state) : update) };
  };
  component.componentDidMount();
  return {
    component,
    card,
    get scroll() { return scroll; },
    get positionReads() { return positionReads; },
    get focused() { return focused; },
    scrollTo(value) { scroll = value; listener?.(); },
    update(nextIds, { target = component.props.target, display = nextIds } = {}) {
      const previous = component.props;
      component.props = { ...previous, events: nextIds.map(id => ({ id })), target };
      const snapshot = component.getSnapshotBeforeUpdate(previous);
      ids = display;
      component.componentDidUpdate(previous, {}, snapshot);
    },
  };
}

for (const embedded of [false, true]) {
  const layout = embedded ? "embedded desktop/mobile scroller" : "window feed";
  test(`${layout}: anchoring deep history reads logarithmically many card positions`, () => {
    const f = fixture(embedded, 2048);
    f.scrollTo(1900 * 160 + 40);
    const snapshot = f.component.getSnapshotBeforeUpdate(f.component.props);
    assert.equal(snapshot.anchor.element.dataset.eventId, "1900");
    assert.ok(f.positionReads <= 16, `Read ${f.positionReads} card positions`);
  });
  test(`${layout}: offscreen arrivals accumulate without moving the visible card`, () => {
    const f = fixture(embedded);
    const before = f.card("d").getBoundingClientRect().top;
    f.update(["x", "a", "b", "c", "d", "e", "f"]);
    assert.equal(f.card("d").getBoundingClientRect().top, before);
    assert.deepEqual(f.component.state.unseen, ["x"]);
    f.update(["y", "x", "a", "b", "c", "d", "e", "f", "older"]);
    assert.equal(f.card("d").getBoundingClientRect().top, before);
    assert.deepEqual(f.component.state.unseen, ["x", "y"]);
    f.update(["y", "x", "a", "b", "c", "d", "e", "f", "older"]);
    assert.equal(f.component.state.unseen.length, 2);
  });

  test(`${layout}: jump focuses the actual newest note, even below a pinned job`, () => {
    const f = fixture(embedded);
    f.update(["new", "a", "b", "c", "d", "e", "f"], { display: ["a", "new", "b", "c", "d", "e", "f"] });
    assert.equal(f.component.state.unseen.length, 1);
    f.component.jumpToLatest();
    assert.equal(f.focused, "new");
    assert.equal(f.scroll, 160);
    assert.deepEqual(f.component.state.unseen, []);
  });

  test(`${layout}: dismiss stays in place and only later arrivals reopen the notice`, () => {
    const f = fixture(embedded);
    f.update(["x", "a", "b", "c", "d", "e", "f"]);
    const before = f.scroll;
    f.component.dismiss();
    assert.equal(f.scroll, before);
    assert.equal(f.focused, "feed");
    assert.deepEqual(f.component.state.unseen, []);
    f.update(["y", "x", "a", "b", "c", "d", "e", "f"]);
    assert.deepEqual(f.component.state.unseen, ["y"]);
  });

  test(`${layout}: reaching the top resets the notice and arrivals at top stay quiet`, () => {
    const f = fixture(embedded);
    f.update(["x", "a", "b", "c", "d", "e", "f"]);
    f.scrollTo(0);
    assert.deepEqual(f.component.state.unseen, []);
    f.update(["y", "x", "a", "b", "c", "d", "e", "f"]);
    assert.equal(f.scroll, 0);
    assert.deepEqual(f.component.state.unseen, []);
  });

  test(`${layout}: source navigation retains ownership of scrolling`, () => {
    const f = fixture(embedded);
    f.update(["a", "b", "c", "d", "e", "f", "older"], { target: "older" });
    assert.equal(f.scroll, 500);
    assert.deepEqual(f.component.state.unseen, []);
  });
}

test("notice has native keyboard buttons, polite status, and shared color tokens", () => {
  const { component } = fixture(true);
  component.state.unseen = ["x", "y"];
  const markup = renderToStaticMarkup(component.render());
  assert.match(markup, /<button type="button"[^>]*data-testid="button-jump-to-latest"/);
  assert.match(markup, /2 new messages · Jump to latest/);
  assert.match(markup, /aria-label="Dismiss new message notice"/);
  assert.match(markup, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(markup, /border-border bg-card/);
  assert.match(markup, /sticky top-2 z-10 h-0/);
});

test("window notice clears the mobile header without offsetting embedded scrollers", () => {
  const windowFeed = fixture(false).component;
  windowFeed.state.unseen = ["x"];
  const markup = renderToStaticMarkup(windowFeed.render());
  assert.match(markup, /sticky top-16 md:top-2 z-10 h-0/);
  assert.match(markup, /<button type="button"[^>]*data-testid="button-jump-to-latest"/);
  assert.match(markup, /<button type="button"[^>]*data-testid="button-dismiss-new-messages"/);
  assert.doesNotMatch(markup, /<button[^>]*(?:disabled|tabindex="-1")/);
  const embedded = renderToStaticMarkup(fixture(true).component.render());
  assert.match(embedded, /sticky top-2 z-10 h-0/);
  assert.doesNotMatch(embedded, /top-16/);
});
