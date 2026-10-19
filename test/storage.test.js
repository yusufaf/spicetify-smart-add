const test = require("node:test");
const assert = require("node:assert/strict");
const { saParseData, saParseConfig } = require("../smart-add.js");

const DEFAULT_DATA = { version: 1, mappings: {} };

test("starts empty when nothing is stored", () => {
  assert.deepEqual(saParseData(null), { data: DEFAULT_DATA, corrupt: false });
});

test("flags unparseable or wrongly shaped data as corrupt and falls back to defaults", () => {
  assert.deepEqual(saParseData("{not json"), { data: DEFAULT_DATA, corrupt: true });
  assert.deepEqual(saParseData('{"version":1,"mappings":[]}'), { data: DEFAULT_DATA, corrupt: true });
  assert.deepEqual(saParseData("null"), { data: DEFAULT_DATA, corrupt: true });
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
  assert.deepEqual(saParseData(JSON.stringify(data)), { data, corrupt: false });
});

test("merges stored config over defaults and ignores garbage", () => {
  assert.deepEqual(saParseConfig('{"maxPerGroup":3}'), { enabled: true, maxPerGroup: 3, showGroupHeaders: true });
  assert.deepEqual(saParseConfig("x"), { enabled: true, maxPerGroup: 5, showGroupHeaders: true });
  assert.deepEqual(saParseConfig(null), { enabled: true, maxPerGroup: 5, showGroupHeaders: true });
});
