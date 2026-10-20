# smart-add — design spec (v1)

Status: approved 2026-10-11. The spike findings below supersede earlier assumptions: v1 covers the form modal only, and the right-click submenu is out of scope.

## Context
Adding a song to the right playlists means scrolling or searching Spotify's "Add to playlist" modal every time, and its order (Saved in / Recents) is effectively random for this purpose. Idea: map sources (artists, podcast shows) to playlists, e.g. Drake → Rap + R&B, and inject a **"Suggested"** section at the top of the native modal so those playlists are one click away.

**Prior art check (done):** nothing does this. The closest are hotkey/slot quick-add tools (`kzndotsh/spicetify-cratedigger`, `dfk789/spicetify-playlist-hotkeys`, `adufr quick-add-to-playlist`) and batch genre sorters (`hoeci/sort-play`, Liked-Songs sorters). None suggests playlists by artist inside the native picker. Spotify Community has open requests for exactly this feature.

## Decisions (from grilling)
| Topic | Decision |
|---|---|
| Interaction | Inject a "Suggested" section above "Saved in" in the native modal |
| Source of suggestions | Manual mappings (v1) + inferred from existing playlists (v1.1) |
| Multi-artist tracks | Union of all credited artists, grouped under per-artist headers, deduped |
| Inference eligibility (v1.1) | Owned/collab playlists only, per-playlist "never suggest" toggle, at least 2 tracks by the artist |
| Podcasts | v1. Keyed on show URI |
| Config entry points | Artist/show context menu, track context menu, settings modal, "promote" pin on inferred rows (v1.1) |
| Click behavior | Instant `PlaylistAPI.add` + plain toast ("Added to Rap"). Doesn't join the native Done/Cancel batch. **No Undo in v1**: removal goes through the native "Saved in" section |
| Phasing | v1 manual, v1.1 inference + exclusions + promote |
| Name | `spicetify-smart-add` |

## Approach: DOM injection, own block (not React patching)
- **Chosen:** a body MutationObserver detects the modal and renders our own `<section>` above "Saved in". Our rows call Platform APIs directly.
- **Rejected:** webpack/React component patching (Konsl-style). It needs fiber or module internals, and none of the user's repos do that.
- **Rejected:** reordering native rows. React re-renders fight us, and the list is virtualized.
- **Tradeoff:** a Spotify UI update can break the anchor selector. Mitigations:
  - Anchor on structure (`role="dialog"` + the searchbox + section headers), never hashed classes.
  - Fail silently: the native modal must still work if our injection fails.

## Data model (`Spicetify.LocalStorage`)
```js
// smart-add-data
{ version: 1,
  mappings: {
    "spotify:artist:3TVXt...": { kind: "artist", name: "Drake", playlists: ["spotify:playlist:a", "spotify:playlist:b"], updatedAt },
    "spotify:show:xyz":        { kind: "show",   name: "Lex Fridman Podcast", playlists: [...], updatedAt }
  } }
// smart-add-config
{ enabled: true, maxPerGroup: 5, showGroupHeaders: true }
```
- Mappings are keyed by URI, not name. `name` is a display cache.
- Playlist names are resolved at render time from the cached rootlist.
- Stale playlist URIs (deleted, or no longer owned) are pruned lazily on render.

## File layout
Single IIFE `smart-add.js` with `//#region` blocks, the same convention as the other 6 repos:
1. **Config/Storage**: load, save, migrate (pattern: `enhanced-pins.js:261-296`)
2. **Platform helpers**:
   - Cached rootlist walk that flattens folders and keeps owned/collab playlists. Port `fetchFolderMap`/`walkNode` from `enhanced-folders.js:175-208`, including the 30s cache and in-flight dedupe.
   - `resolveSources(uris)`: track → artist URIs+names via `GraphQL Definitions.getTrack` (see `listening-list.js:318`); episode → show URI.
3. **Mappings store**: `getMapping`, `setMapping(sourceUri, playlistUris)`, `removeMapping`, `prune`
4. **Trigger capture**: work out *which* track(s) opened the modal:
   - Row "+" button: capture-phase click listener reads the row's track URI.
   - Now-playing "+": `Spicetify.Player.data.item.uri`.
   - Every capture is stored as `{uris, at}`. The injector runs only if `at` falls within ~2s before the modal opened. Wrong suggestions are worse than none.
   - **Prefetch:** start `resolveSources` at capture time, since `shouldAdd` fires before the modal exists. Keep an LRU cache of track→sources (~200 entries). For now-playing, use `Player.data.item.artists` directly with no request.
5. **Modal injector**: observer, then:
   - `buildSuggestionGroups`
   - render the section (styled to match native rows, reusing the modal's own text classes where possible)
   - click calls `PlaylistAPI.add(playlistUri, missingUris, {after:'end'})` (pattern: `enhanced-pins.js:2364-2375`), then a plain `Spicetify.showNotification`. The row flips to ✓ and is disabled.
   - playlists that already hold the track show ✓ and are disabled; removal stays in the native "Saved in" section
   - **Duplicate guard:** add only the URIs not already in the playlist. If membership can't be read by URI (unknown #3), check the clicked playlist's contents first.
   - **Search:** hide the section while the "Find a playlist" query is non-empty.
   - **Caps:** at most 3 groups (matters for whole-album adds) and `maxPerGroup` rows each.
   - **Header** names the source ("Suggested · Drake") so a wrong-track mismatch is visible.
6. **Mapping editor**: `PopupModal` with a searchable checkbox list of owned playlists for one source
7. **Context menus**:
   - "Playlist mappings…" on artist/show URIs (`Spicetify.URI.isArtist` / show check)
   - "Map artist to playlists…" on tracks; if there are several artists, pick one first
8. **Settings modal**: opened from a profile-menu `Spicetify.Menu.Item` (pattern: `enhanced-pins.js:638-645`). Holds the mappings table (edit/delete), config toggles, and JSON export/import. Reuse the isLarge PopupModal CSS fix (`enhanced-pins.js:2829`).
9. **Init**: poll for the APIs it needs (pattern: `enhanced-pins.js:3448`)

## Data flow (modal open)
1. The trigger handler stores `lastUris`.
2. The observer sees the dialog with the "Find a playlist" searchbox.
3. `resolveSources(lastUris)` returns `[{uri, name, kind}]`, primary artist first.
4. `buildSuggestionGroups` runs.
5. If the result is empty, render nothing. Otherwise inject the section.

**Learning checkpoint (you write it):** `buildSuggestionGroups(sources, mappings, savedInSet, maxPerGroup)` returns `[{ source, rows: [{playlistUri, saved}] }]`. It is about 10–15 lines of grouping, dedupe and capping logic:
- A playlist mapped to both Drake and Future appears only once, under the earlier source.
- Groups with no rows are dropped.

The interesting choice is which group wins a duplicate, and whether the cap counts saved rows.

## Error handling
- Every injector/render path is wrapped in try/catch and logged with a `[smart-add]` prefix. The native modal is never blocked.
- If `PlaylistAPI.add` fails, show an error toast and the row reverts.
- If track→artist resolution fails, skip the section. If it isn't ready within ~300ms of the modal opening, skip it too. Injecting late shifts the list under your cursor and causes misclicks.
- If React removes our node, re-inject it from the observer. If React throws on the foreign node, disable injection for that modal instance and log it.
- Corrupt storage falls back to defaults. The raw value is kept under `smart-add-data-backup`.

## Open unknowns (resolve first, live spike via the `spicetify-live-test` skill)
0. **Highest risk: is there a safe mount point?** React can throw `NotFoundError` on foreign nodes when it re-renders. Find a spot where our node survives typing in search, scrolling and closing, ideally outside React's managed child list. If none exists, stop and rethink (fallback: our own context-menu submenu).
1. Stable selectors for the new modal: dialog role, searchbox, and the "Saved in"/"Recents" headers. Prefer structure over text, since text only works in English. Document the locale limitation in the README.
1b. **Native Done after our instant add:** does it apply only the diff? Or could it undo our add or duplicate it? If it conflicts, fall back to a "Close" hint, or disable native rows for playlists we've already added to.
2. Does every entry point (row "+", context menu, now-playing "+", multi-select) open the same modal? Which URIs can be captured for each?
3. "Already saved" state: is there a Platform `contains` API, or do we read the native "Saved in" section's names?
4. Does the ownership flag show up in rootlist items, or is a `PlaylistAPI.getMetadata` owner check needed?
5. Is there a GraphQL definition for episode → show?

## Spike results (2026-10-11, Spotify live client, Spicetify 2.45.2)
- **#0 mount point: SAFE (confirmed).**
  - `form.insertBefore(section, ul)` (between the search row and the `ul`) rendered correctly. The flex layout shrinks the `ul`.
  - It survived search typing (`r`, `ra`, `rap`, cleared) with 0 console errors, and the form's own child count stayed stable.
  - Still to re-verify in the real build: close and reopen. The form is recreated on reopen, so the observer must re-inject. Scrolling the list is untested.
- **#1 selectors: locale-independent anchors exist.**
  - The modal is **not** a `role=dialog`. It is a `form` (child of `body > div > div`) with 4 children: header div, search div (`input[role=searchbox]`), `ul[role=menu]`, and a footer div (`button` "Cancel").
  - Anchor on `form` that contains both `input[role=searchbox]` and `ul[role=menu]`. No text matching and no hashed classes needed.
  - The "Saved in"/"Recents" headers are plain `div`s, not used.
- **#3 saved state: readable from DOM, no extra API.** Every row is `button[role=menuitemcheckbox][aria-checked=true|false]`, and its `aria-labelledby="listrow-title-spotify:playlist:<id>"` carries the playlist URI. That also means duplicate guard and ✓ state can use the native rows (URIs, not names), and a clicked Suggested row can find its native twin if it is rendered.
- **#4 ownership: available on rootlist items.** `isOwnedBySelf`, `canAdd`, `canEditItems`, and `permissions`/`collaborators` (for collab playlists). Filter on `canAdd` (the spike's first sample was `false`; it is probably a followed playlist).
- **#5 GraphQL:** definitions exist: `getTrack`, `getTrackName`, `queryTrackArtists`, `getEpisodeName`, `queryNpvEpisode`. Which one returns the show URI is still unconfirmed.
- **#2 entry points: TWO different UIs (confirmed).**
  - Row "+" (`button[aria-label="Add to playlist"]` in the tracklist) and now-playing "+" (`[data-testid=now-playing-widget] button[aria-label="Add to playlist"]`) both open the **same `form` modal** (4 children, 16–20 rows rendered, footer "Cancel"). The observer fires twice per open because of nested matches, so dedupe on the form node.
  - Right-click → "Add to playlist" does **not** open the modal. It expands a **legacy submenu inside `#context-menu`**: a nested `[role=menu]` (66 `li`s on this machine) that contains its own "Find a playlist" search input, an empty first `li`, then "New playlist" and a flat playlist list. It is **not** a `form`. A selector that only checks for the searchbox would match both UIs, so the form check (`form` + searchbox + `ul[role=menu]`) is what keeps them apart.
  - Multi-select (ctrl-click, 2 rows) → right-click → same legacy submenu. The "+" button is per-row, so multi-select only reaches the submenu.
  - Synthetic DOM events are ignored for right-click and menus. Tests need real input via CDP `Input.dispatchMouseEvent` (throwaway script in scratchpad: `entry-points.mjs`, `submenu.mjs`). Left-clicking a row's title/album cell navigates away, so click the index column.
- **#5 episode → show: resolved.** `queryNpvEpisode({uri})` returns `data.episodeUnionV2.podcastV2.data.{uri,name}` (e.g. `spotify:show:5uKs…`). Items from `PlaylistAPI.getContents` already carry `show.uri`. Track items carry `artists[].uri/name`. `queryTrackArtists` returned `HttpResponseError` with `{uri}`; use `getTrack` or a context/item object instead. A `getTrack` artists path is still to confirm.
- **Still open:**
  - **#1b**: native Done after our instant add. Needs a mutation test on a throwaway playlist, so ask the user first.
  - **Scope decision (made): v1 covers the form modal only.** The legacy `#context-menu` submenu stays native, so right-click and multi-select adds get no suggestions. Revisit in v1.1. Trigger capture can therefore drop the right-click `shouldAdd` recording and rely on the row "+" capture-phase listener and now-playing "+".
  - Track → artists for a bare URI (via `getTrack` or `Player.data.item.artists`).
  - Scroll the list and close/reopen with our node mounted (re-verify in the real build).

## Implementation probes (2026-10-18, Spotify 1.2.x, Spicetify 2.45.3)
- **Track → artists:** `getTrack` returns `trackUnion.firstArtist.items[]` and `trackUnion.otherArtists.items[]`, each `{ uri, profile.name }`.
- **Rootlist:** playlist items carry `type`, `uri`, `name`, `canAdd`, `isOwnedBySelf`; folders carry `items`. On the test account `canAdd` matched `isOwnedBySelf` (63 of 153).
- **Episode → show:** `queryNpvEpisode` works for a real episode (`spotify:episode:0aM69uGff54ewQJzQxZVLf` → Lex Fridman Podcast).
- **The "+" button is the save button.** Rows, the now-playing bar and the right panel (`#Desktop_PanelContainer_Id`) share one `button[aria-checked]`: unsaved it reads "Add to Liked Songs" and saves; saved it opens the Add to playlist modal. Its label is the only text that changes, so capture keys on `button[aria-checked]` (no text) and records every click; freshness and one-shot use stop a Liked Songs click from driving a later modal.
- **Row URI:** rows have no track link or URI attribute. The URI is in React props: walk `__reactFiber$…` up via `.return` to the first `memoizedProps.uri` that is a track/episode (depth ~2). Reading props only, no patching.

## v1.1 (separate spec later)
- Inference index: artist → {playlist: count}, built in the background over owned playlists and refreshed incrementally.
- Per-playlist exclusions.
- Promote pin on inferred rows.

## Order of work
1. **Throwaway spike first, before any repo scaffolding.** Use CDP + `spicetify-live-test` to answer unknowns 0–5 in the live client: inject a dummy section, type, scroll, hit Done, and capture selectors. The whole design depends on #0. Record the findings in the spec and treat the spike code as throwaway.
2. Only then scaffold the repo and write the implementation plan.

## Repo / delivery
- Repo `C:\Projects\spicetify-smart-add` mirrors the existing repos (scaffolded 2026-10-11):
  - pnpm, husky, commitlint
  - `pnpm test` = `node --check smart-add.js`
  - `manifest.json`, README, CONTRIBUTING, LICENSE (MIT), `CLAUDE.md` (region map + invariants), `tests.live.md`
  - release-please workflow + manifest + the `// VERSION:` banner, and `notify-docs.yml`
- Dev loop: plain copies into `%APPDATA%\spicetify\Extensions\` and `%APPDATA%\Spotify\Apps\xpui\extensions\` (no symlinks or hardlinks).
- After v1 ships: add an entry to `src/data/extensions.mjs` in spicetify-site.
- Next: write the implementation plan (writing-plans).
- Creating the GitHub repo is an outward-facing action, so confirm first.

## Verification
- `pnpm test` (syntax check) passes.
- Run the `tests.live.md` scenarios in the live client via CDP (`spicetify-live-test`):
  - T1: map Drake → Rap, R&B through the artist context menu.
  - T2: open the modal on a Drake track: Suggested shows Rap and R&B above Saved in. Screenshot.
  - T3: click Rap: the track is added, the toast appears, the row shows ✓. Reopening the modal shows Rap ✓, and Rap is listed in native "Saved in".
  - T3b: click Rap in Suggested, tick a native Recents row, hit Done: both adds persist and nothing is duplicated.
  - T3c: type in "Find a playlist": Suggested hides with no console errors. Clear the query and Suggested comes back.
  - T3d: add a whole 20-track album: at most 3 groups, and only missing tracks are added.
  - T4: a Drake + Future track shows two deduped groups.
  - T5: a podcast episode with a show mapping shows suggestions.
  - T6: a track with no mapping leaves the modal unchanged.
  - T7: a deleted mapped playlist is pruned with no error.
  - T8: with the injection selector broken on purpose, the native modal still works.
- Export settings, then re-import them; the result is identical.
