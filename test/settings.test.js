const test = require("node:test");
const assert = require("node:assert/strict");
const { saParseImport, saExportText } = require("../smart-add.js");

const DATA = {
  version: 1,
  mappings: {
    "spotify:artist:3TVXtAsR1Inumwj472S9r4": { kind: "artist", name: "Drake", playlists: ["spotify:playlist:a"], updatedAt: 1760000000000 },
  },
};
const CONFIG = { enabled: true, maxPerGroup: 3, showGroupHeaders: false };

test("an export imports back to the same data and config", () => {
  assert.deepEqual(saParseImport(saExportText(DATA, CONFIG)), { data: DATA, config: CONFIG });
});

test("rejects files that aren't a Smart Add export", () => {
  for (const text of ["nope", '{"app":"enhanced-pins"}', JSON.stringify({ app: "smart-add", data: { version: 1, mappings: [] } })]) {
    assert.throws(() => saParseImport(text), { message: "Not a Smart Add export" });
  }
});

test("fills in config defaults for an export without config", () => {
  const text = JSON.stringify({ app: "smart-add", data: DATA });
  assert.deepEqual(saParseImport(text).config, { enabled: true, maxPerGroup: 5, showGroupHeaders: true });
});

test("rejects an export with a malformed mapping instead of importing part of it", () => {
  const text = JSON.stringify({ app: "smart-add", data: { version: 1, mappings: { "spotify:artist:x": {} } } });
  assert.throws(() => saParseImport(text), { message: "Not a Smart Add export" });
});
