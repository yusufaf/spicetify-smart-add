const test = require("node:test");
const assert = require("node:assert/strict");
const { saPlaylistUriFromLabelledBy } = require("../smart-add.js");

test("reads the playlist URI off a native modal row's aria-labelledby", () => {
  assert.equal(saPlaylistUriFromLabelledBy("listrow-title-spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"), "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M");
});

test("ignores rows that aren't playlists", () => {
  assert.equal(saPlaylistUriFromLabelledBy(null), null);
  assert.equal(saPlaylistUriFromLabelledBy("listrow-title-spotify:album:x"), null);
  assert.equal(saPlaylistUriFromLabelledBy("something-else"), null);
});

// Minimal stand-in for a native row button: Spotify puts aria-labelledby on a child div, older builds on the button.
const fakeButton = ({ own = null, child = null }) => ({
  getAttribute: (name) => (name === "aria-labelledby" ? own : null),
  querySelector: (selector) =>
    child && selector.includes("aria-labelledby") ? { getAttribute: () => child } : null,
});

test("reads a native row's playlist URI from its labelled child or from the button itself", () => {
  const { saNativeRowUri } = require("../smart-add.js");
  assert.equal(saNativeRowUri(fakeButton({ child: "listrow-title-spotify:playlist:2P1GNnaUPM1erjyLXOe5Vp" })), "spotify:playlist:2P1GNnaUPM1erjyLXOe5Vp");
  assert.equal(saNativeRowUri(fakeButton({ own: "listrow-title-spotify:playlist:abc" })), "spotify:playlist:abc");
  assert.equal(saNativeRowUri(fakeButton({})), null);
});
