# Live Tests — Smart Add

Extension file: `smart-add.js`
Use skill `spicetify-live-test` for CDP mechanics (reload, eval, screenshot, console). Synthetic DOM events are ignored for right-click and menus, so drive those with CDP `Input.dispatchMouseEvent`. When left-clicking a track row, click the index column, since clicking title/album cells navigates away.

## Storage keys (`Spicetify.LocalStorage.get(key)`)

| Key | Contents |
|-----|----------|
| `smart-add-data` | JSON `{ version, mappings: { <artist/show uri>: { kind, name, playlists[], updatedAt } } }` |
| `smart-add-config` | JSON `{ enabled, maxPerGroup, showGroupHeaders }` |
| `smart-add-data-backup` | Raw `smart-add-data` saved when it was unreadable at startup |

The extension isn't in this machine's Spicetify config during development. Instead of `spicetify apply`, reload xpui over CDP and evaluate `smart-add.js` into the page. Snapshot `smart-add-*` keys before a run and restore them after. Tests that add tracks use throwaway playlists created for the run (`RootlistAPI.createPlaylist`) and deleted afterwards (`RootlistAPI.remove`, one URI per call; a batch call silently does nothing).

The "+" on a row or in the now-playing bar only opens the modal when the item is already saved; on an unsaved item it saves to Liked Songs. Use tracks from Liked Songs, and hover the row before clicking, because the button only renders on hover.

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
- **T9:** Now-playing "+" (and the Now Playing view's "+") opens the same modal and shows suggestions for the playing track. Needs a saved track playing.
- **T10:** Right-click → Add to playlist (older submenu) is untouched.
- **T11:** Export settings, then re-import them; the result is identical.
- **T12:** A playlist that already holds the track but isn't marked ✓ (row not rendered): clicking it toasts "Already in <name>" and adds nothing.
- **T13:** Click a Suggested row, then click that playlist's native row: the native click does nothing (no pending removal on Done).
- **T14:** Create a playlist, map it, and open the modal within 30 s: the new playlist is suggested and the mapping survives.
- **T15:** Import a file that isn't a Smart Add export: error toast, mappings unchanged.
