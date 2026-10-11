# Live Tests — Smart Add

Extension file: `smart-add.js`
Use skill `spicetify-live-test` for CDP mechanics (reload, eval, screenshot, console). Synthetic DOM events are ignored for right-click and menus, so drive those with CDP `Input.dispatchMouseEvent`. When left-clicking a track row, click the index column, since clicking title/album cells navigates away.

## Storage keys (`Spicetify.LocalStorage.get(key)`)

| Key | Contents |
|-----|----------|
| `smart-add-data` | JSON `{ version, mappings: { <artist/show uri>: { kind, name, playlists[], updatedAt } } }` |
| `smart-add-config` | JSON `{ enabled, maxPerGroup, showGroupHeaders }` |

## Smoke test (run after every edit)

1. `node --check smart-add.js` — syntax gate.
2. Copy `smart-add.js` into `%APPDATA%\spicetify\Extensions\` and `%APPDATA%\Spotify\Apps\xpui\extensions\`.
3. CDP reload xpui.
4. Console (filter `Smart Add`): expect `[Smart Add] Starting...` then `[Smart Add] Initialized`, no errors.

## Scenarios

- **T1:** Map Drake → Rap, R&B through the artist context menu.
- **T2:** Open the modal on a Drake track via the row "+": Suggested shows Rap and R&B above "Saved in". Screenshot.
- **T3:** Click Rap: the track is added, the toast appears, the row shows ✓. Reopening the modal shows Rap ✓, and Rap is listed in native "Saved in".
- **T3b:** Click Rap in Suggested, tick a native Recents row, hit Done: both adds persist and nothing is duplicated.
- **T3c:** Type in "Find a playlist": Suggested hides with no console errors. Clear the query and Suggested comes back.
- **T3d:** Add a whole 20-track album: at most 3 groups, and only missing tracks are added.
- **T4:** A Drake + Future track shows two deduped groups.
- **T5:** A podcast episode with a show mapping shows suggestions.
- **T6:** A track with no mapping leaves the modal unchanged.
- **T7:** A deleted mapped playlist is pruned with no error.
- **T8:** With the injection selector broken on purpose, the native modal still works.
- **T9:** Now-playing "+" opens the same modal and shows suggestions for the playing track.
- **T10:** Right-click → Add to playlist (older submenu) is untouched.
- **T11:** Export settings, then re-import them; the result is identical.
