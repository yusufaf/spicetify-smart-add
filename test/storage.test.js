const test = require("node:test");
const assert = require("node:assert/strict");
const { saParseData, saParseConfig } = require("../smart-add.js");

const DEFAULT_DATA = { version: 1, mappings: {} };

test("starts empty when nothing is stored", () => {
  assert.deepEqual(saParseData(null), { data: DEFAULT_DATA, corrupt: false, dropped: 0 });
});

test("flags unparseable or wrongly shaped data as corrupt and falls back to defaults", () => {
  assert.deepEqual(saParseData("{not json"), { data: DEFAULT_DATA, corrupt: true, dropped: 0 });
  assert.deepEqual(saParseData('{"version":1,"mappings":[]}'), { data: DEFAULT_DATA, corrupt: true, dropped: 0 });
  assert.deepEqual(saParseData("null"), { data: DEFAULT_DATA, corrupt: true, dropped: 0 });
});

test("keeps a valid stored mapping unchanged", () => {
  const data = {
    version: 1,
    mappings: {
      "spotify:artist:3TVXtAsR1Inumwj472S9r4": {
        kind: "artist",
        name: "Drake",
        playlists: ["spotify:playlist:a", "spotify:playlist:b"],
        updatedAt: 1760000000000,
      },
    },
  };
  assert.deepEqual(saParseData(JSON.stringify(data)), { data, corrupt: false, dropped: 0 });
});

test("merges stored config over defaults and ignores garbage", () => {
  assert.deepEqual(saParseConfig('{"maxPerGroup":3}'), { enabled: true, maxPerGroup: 3, showGroupHeaders: true });
  assert.deepEqual(saParseConfig("x"), { enabled: true, maxPerGroup: 5, showGroupHeaders: true });
  assert.deepEqual(saParseConfig(null), { enabled: true, maxPerGroup: 5, showGroupHeaders: true });
});

test("replaces config values of the wrong type or out of range with defaults", () => {
  const defaults = { enabled: true, maxPerGroup: 5, showGroupHeaders: true };
  assert.deepEqual(saParseConfig('{"maxPerGroup":0}'), defaults);
  assert.deepEqual(saParseConfig('{"maxPerGroup":11}'), defaults);
  assert.deepEqual(saParseConfig('{"maxPerGroup":2.5}'), defaults);
  assert.deepEqual(saParseConfig('{"maxPerGroup":"x","enabled":"false","showGroupHeaders":1}'), defaults);
  assert.deepEqual(saParseConfig('{"enabled":false,"extra":1}'), { ...defaults, enabled: false });
  assert.deepEqual(saParseConfig("[1,2]"), defaults);
});

test("drops mapping entries with the wrong shape and counts them", () => {
  const good = { kind: "show", name: "Lex Fridman Podcast", playlists: ["spotify:playlist:a"], updatedAt: 1 };
  const raw = JSON.stringify({
    version: 1,
    mappings: {
      "spotify:show:good": good,
      "spotify:artist:empty": {},
      "spotify:artist:badlist": { kind: "artist", name: "X", playlists: "spotify:playlist:a", updatedAt: 1 },
      "spotify:artist:badkind": { kind: "album", name: "X", playlists: [], updatedAt: 1 },
      "spotify:artist:badname": { kind: "artist", name: 5, playlists: ["spotify:playlist:a"], updatedAt: 1 },
    },
  });
  assert.deepEqual(saParseData(raw), { data: { version: 1, mappings: { "spotify:show:good": good } }, corrupt: false, dropped: 4 });
});
