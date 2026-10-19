const test = require("node:test");
const assert = require("node:assert/strict");
const { saFlattenRootlist, saTrackArtists, saCreateLru } = require("../smart-add.js");

// Trimmed from RootlistAPI.getContents() in Spotify 1.2.x (2026-10-18).
const ROOTLIST = {
  type: "folder",
  name: "",
  items: [
    { type: "playlist", uri: "spotify:playlist:rap", name: "Rap", canAdd: true, isOwnedBySelf: true, images: [{ url: "spotify:image:ab67616d00001e02abe203531eac29d17260966f", label: "standard" }] },
    { type: "playlist", uri: "spotify:playlist:followed", name: "Best Ambient Tracks Ever", canAdd: false, isOwnedBySelf: false },
    {
      type: "folder",
      uri: "spotify:user:me:folder:f1",
      name: "Genres",
      items: [{ type: "playlist", uri: "spotify:playlist:rnb", name: "R&B", canAdd: true, isOwnedBySelf: true }],
    },
    { type: "playlist", uri: "spotify:playlist:jazz", name: "Jazz", canAdd: true, isOwnedBySelf: true },
  ],
};

// Trimmed from GraphQL getTrack on "Jimmy Cooks" (Drake, 21 Savage).
const TRACK_UNION = {
  uri: "spotify:track:3F5CgOj3wFlRv51JsHbxhe",
  firstArtist: { items: [{ uri: "spotify:artist:3TVXtAsR1Inumwj472S9r4", profile: { name: "Drake" } }], totalCount: 1 },
  otherArtists: { items: [{ uri: "spotify:artist:1URnnhqYAYcrqrcwql10ft", profile: { name: "21 Savage" } }] },
};

test("flattens folders and keeps only playlists the user can add to, in rootlist order", () => {
  assert.deepEqual(saFlattenRootlist(ROOTLIST), [
    { uri: "spotify:playlist:rap", name: "Rap", image: "spotify:image:ab67616d00001e02abe203531eac29d17260966f" },
    { uri: "spotify:playlist:rnb", name: "R&B", image: "" },
    { uri: "spotify:playlist:jazz", name: "Jazz", image: "" },
  ]);
  assert.deepEqual(saFlattenRootlist(null), []);
});

test("lists the primary artist first, then featured artists", () => {
  assert.deepEqual(saTrackArtists(TRACK_UNION), [
    { uri: "spotify:artist:3TVXtAsR1Inumwj472S9r4", name: "Drake", kind: "artist" },
    { uri: "spotify:artist:1URnnhqYAYcrqrcwql10ft", name: "21 Savage", kind: "artist" },
  ]);
});

test("lists an artist credited twice only once", () => {
  const twice = { ...TRACK_UNION, otherArtists: { items: [TRACK_UNION.firstArtist.items[0]] } };
  assert.equal(saTrackArtists(twice).length, 1);
});

test("returns no artists for a missing track", () => {
  assert.deepEqual(saTrackArtists(undefined), []);
});

test("evicts the least recently used entry", () => {
  const lru = saCreateLru(2);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.get("a");
  lru.set("c", 3);
  assert.equal(lru.get("b"), undefined);
  assert.equal(lru.get("a"), 1);
  assert.equal(lru.get("c"), 3);
});
