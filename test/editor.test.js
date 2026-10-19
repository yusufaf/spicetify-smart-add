const test = require("node:test");
const assert = require("node:assert/strict");
const { saFilterPlaylists, saNextPlaylists } = require("../smart-add.js");

const PLAYLISTS = [
  { uri: "spotify:playlist:rap", name: "Rap", image: "" },
  { uri: "spotify:playlist:rnb", name: "R&B Slow Jams", image: "" },
  { uri: "spotify:playlist:jazz", name: "Jazz", image: "" },
];

test("filters playlists by name, ignoring case and surrounding spaces", () => {
  assert.deepEqual(saFilterPlaylists(PLAYLISTS, "  slow ").map((p) => p.name), ["R&B Slow Jams"]);
  assert.equal(saFilterPlaylists(PLAYLISTS, "").length, 3);
});

test("keeps the existing order for playlists still checked and appends new ones in list order", () => {
  const previous = ["spotify:playlist:jazz", "spotify:playlist:rap"];
  const checked = new Set(["spotify:playlist:rap", "spotify:playlist:rnb", "spotify:playlist:jazz"]);
  assert.deepEqual(saNextPlaylists(previous, checked, PLAYLISTS.map((p) => p.uri)), [
    "spotify:playlist:jazz",
    "spotify:playlist:rap",
    "spotify:playlist:rnb",
  ]);
});

test("drops playlists that were unchecked", () => {
  const previous = ["spotify:playlist:jazz", "spotify:playlist:rap"];
  assert.deepEqual(saNextPlaylists(previous, new Set(["spotify:playlist:rap"]), PLAYLISTS.map((p) => p.uri)), ["spotify:playlist:rap"]);
});

test("escapes names before they go into a modal title, which Spicetify renders as HTML", () => {
  const { saEscapeHtml } = require("../smart-add.js");
  assert.equal(saEscapeHtml(`<img src=x onerror="alert(1)"> & 'co'`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;co&#39;");
});
