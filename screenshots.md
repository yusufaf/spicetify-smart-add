# Screenshots — Smart Add

How `preview.png` and the README images are made. Use the `spicetify-screenshots` skill for the mechanics.

## Shot list

| File | Shows | Clip |
|------|-------|------|
| `preview.png` | Suggested section in the Add to playlist modal, two artist groups, one ✓ row | Square over the modal's top: title, search, Suggested |
| `screenshots/settings.png` | Settings modal with the fixture mappings only | The settings dialog |

## Readiness predicate

`document.querySelectorAll('form #sa-suggested .sa-row').length >= 3` and `.sa-header` count is 2.

## Fixtures

Playlist URIs differ per account, so the fixture is created at shoot time, not committed:

1. Snapshot `smart-add-*` keys.
2. Create three playlists: **Rap**, **Cloud Rap**, **Late Night**. Add one public track to each so it gets a cover: Rap ← "Jimmy Cooks" (`spotify:track:3F5CgOj3wFlRv51JsHbxhe`), Cloud Rap ← "Morning Dew" (`spotify:track:0YkXRZcetpqI3VzjE9Sey6`, so it shows ✓), Late Night ← "60 mgs" (`spotify:track:3g0UsA0hxpwAtkrk9JHW9l`).
3. Write `smart-add-data` with Xavier Wulf → Rap, Cloud Rap and BONES → Cloud Rap, Late Night.
4. Reload, then open the modal from the "+" on "Morning Dew" (it must be in Liked Songs, since the "+" only opens the modal for saved tracks).
5. Afterwards: restore the snapshot and delete the three playlists.

## Disambiguation

| Looks like | Is | Selector |
|------------|----|----------|
| Green ✓ on the right of a Suggested row | Ours: playlist already holds the track | `#sa-suggested .sa-row-mark` |
| Green ✓ disc in native "Saved in" rows and track rows | Spotify's saved state | `button[role=menuitemcheckbox][aria-checked=true]`, `[role=row] button[aria-checked]` |
| "Suggested · <artist>" header | Ours | `#sa-suggested .sa-header` |

## Privacy

The modal's lower half lists the account's own playlists under "Saved in" and Recents. Every clip stops above "Saved in". Read each PNG back before committing.
