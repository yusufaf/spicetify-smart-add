const test = require("node:test");
const assert = require("node:assert/strict");
const { saPruneMappings, buildSuggestionGroups } = require("../smart-add.js");

const DRAKE = { uri: "spotify:artist:drake", name: "Drake", kind: "artist" };
const FUTURE = { uri: "spotify:artist:future", name: "Future", kind: "artist" };
const SZA = { uri: "spotify:artist:sza", name: "SZA", kind: "artist" };
const KENDRICK = { uri: "spotify:artist:kendrick", name: "Kendrick Lamar", kind: "artist" };
const NOBODY = { uri: "spotify:artist:nobody", name: "Nobody", kind: "artist" };

const mapping = (source, playlists) => ({ kind: source.kind, name: source.name, playlists, updatedAt: 1 });
const rows = (groups) => groups.map((g) => [g.source.name, g.rows.map((r) => r.playlistUri)]);

test("prune drops playlists that no longer exist and mappings left empty", () => {
  const mappings = {
    [DRAKE.uri]: mapping(DRAKE, ["rap", "gone"]),
    [FUTURE.uri]: mapping(FUTURE, ["gone"]),
  };
  const result = saPruneMappings(mappings, new Set(["rap"]));
  assert.deepEqual(result.mappings, { [DRAKE.uri]: mapping(DRAKE, ["rap"]) });
  assert.equal(result.removed, 2);
});

test("prune leaves mappings alone when no playlists could be read", () => {
  const mappings = { [DRAKE.uri]: mapping(DRAKE, ["rap"]) };
  assert.deepEqual(saPruneMappings(mappings, new Set()), { mappings, removed: 0 });
});

test("a playlist mapped to two credited artists appears once, under the earlier artist", () => {
  const mappings = { [DRAKE.uri]: mapping(DRAKE, ["rap", "rnb"]), [FUTURE.uri]: mapping(FUTURE, ["rap", "trap"]) };
  const groups = buildSuggestionGroups([DRAKE, FUTURE], mappings, new Set(), 5);
  assert.deepEqual(rows(groups), [["Drake", ["rap", "rnb"]], ["Future", ["trap"]]]);
});

test("sources with no mapping, or whose playlists were all shown already, get no group", () => {
  const mappings = { [DRAKE.uri]: mapping(DRAKE, ["rap"]), [FUTURE.uri]: mapping(FUTURE, ["rap"]) };
  const groups = buildSuggestionGroups([NOBODY, DRAKE, FUTURE], mappings, new Set(), 5);
  assert.deepEqual(rows(groups), [["Drake", ["rap"]]]);
});

test("shows at most 3 groups and maxPerGroup rows per group", () => {
  const mappings = {
    [DRAKE.uri]: mapping(DRAKE, ["a", "b", "c"]),
    [FUTURE.uri]: mapping(FUTURE, ["d"]),
    [SZA.uri]: mapping(SZA, ["e"]),
    [KENDRICK.uri]: mapping(KENDRICK, ["f"]),
  };
  const groups = buildSuggestionGroups([DRAKE, FUTURE, SZA, KENDRICK], mappings, new Set(), 2);
  assert.deepEqual(rows(groups), [["Drake", ["a", "b"]], ["Future", ["d"]], ["SZA", ["e"]]]);
});

test("marks playlists that already hold the track as saved", () => {
  const mappings = { [DRAKE.uri]: mapping(DRAKE, ["rap", "rnb"]) };
  const [group] = buildSuggestionGroups([DRAKE], mappings, new Set(["rnb"]), 5);
  assert.deepEqual(group.rows, [{ playlistUri: "rap", saved: false }, { playlistUri: "rnb", saved: true }]);
});

test("saved rows don't count toward maxPerGroup, so they never hide a playlist the track could still go in", () => {
  const mappings = { [DRAKE.uri]: mapping(DRAKE, ["a", "b", "c", "d"]) };
  const [group] = buildSuggestionGroups([DRAKE], mappings, new Set(["a"]), 2);
  assert.deepEqual(group.rows, [
    { playlistUri: "a", saved: true },
    { playlistUri: "b", saved: false },
    { playlistUri: "c", saved: false },
  ]);
});
