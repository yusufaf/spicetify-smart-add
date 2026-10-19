const test = require("node:test");
const assert = require("node:assert/strict");
const { saIsFresh, saRowUri } = require("../smart-add.js");

const NOW = 1_000_000;
const capture = (ageMs, used = false) => ({ uris: ["spotify:track:x"], at: NOW - ageMs, sources: Promise.resolve([]), used });

test("a capture is fresh for 2 seconds and only until a modal uses it", () => {
  assert.equal(saIsFresh(null, NOW), false);
  assert.equal(saIsFresh(capture(100, true), NOW), false);
  assert.equal(saIsFresh(capture(2001), NOW), false);
  assert.equal(saIsFresh(capture(-5), NOW), false);
  assert.equal(saIsFresh(capture(1999), NOW), true);
});

// Mimics how React hangs fibers off DOM nodes: the row's own props lack the URI, an ancestor component has it.
const fakeRow = (fiberChain) => {
  let fiber = null;
  for (const props of [...fiberChain].reverse()) fiber = { memoizedProps: props, return: fiber };
  return { "__reactFiber$abc123": fiber };
};

test("reads a track row's URI from the nearest component that has one", () => {
  const row = fakeRow([{ role: "row" }, { index: 0 }, { uri: "spotify:track:70cHKK8bHAfJrOGVnfRG9J" }, { uri: "spotify:playlist:ctx" }]);
  assert.equal(saRowUri(row), "spotify:track:70cHKK8bHAfJrOGVnfRG9J");
});

test("reads an episode row's URI", () => {
  assert.equal(saRowUri(fakeRow([{ uri: "spotify:episode:0aM69uGff54ewQJzQxZVLf" }])), "spotify:episode:0aM69uGff54ewQJzQxZVLf");
});

test("ignores non-track URIs and rows without React data", () => {
  assert.equal(saRowUri(fakeRow([{ uri: "spotify:album:a" }, { uri: "spotify:playlist:p" }])), null);
  assert.equal(saRowUri({}), null);
  assert.equal(saRowUri(null), null);
});

// A fake element: `inside` lists the selectors its ancestors match; props become its React fiber chain.
const fakeEl = ({ inside = [], props = [] } = {}) => {
  const el = fakeRow(props);
  el.closest = (selector) => (selector.split(",").some((s) => inside.includes(s.trim())) ? el : null);
  return el;
};
const PLAYING = { uri: "spotify:track:playing" };

test("a row button gives the row's track", () => {
  const { saClickedItemUri } = require("../smart-add.js");
  assert.equal(saClickedItemUri(fakeEl({ inside: ["[role=row]"], props: [{ uri: "spotify:track:row" }] }), PLAYING), "spotify:track:row");
});

test("a now-playing button gives the playing track unless its own props name another track", () => {
  const { saClickedItemUri } = require("../smart-add.js");
  assert.equal(saClickedItemUri(fakeEl({ inside: ["[data-testid=now-playing-widget]"] }), PLAYING), "spotify:track:playing");
  assert.equal(saClickedItemUri(fakeEl({ inside: ["#Desktop_PanelContainer_Id"], props: [{ uri: "spotify:track:next" }] }), PLAYING), "spotify:track:next");
});

test("buttons anywhere else, or rows without a readable URI, give nothing", () => {
  const { saClickedItemUri } = require("../smart-add.js");
  assert.equal(saClickedItemUri(fakeEl(), PLAYING), null);
  assert.equal(saClickedItemUri(fakeEl({ inside: ["[role=row]"] }), PLAYING), null);
  assert.equal(saClickedItemUri(fakeEl({ inside: ["#Desktop_PanelContainer_Id"] }), undefined), null);
});
