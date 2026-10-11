# Smart Add

Map artists and podcast shows to playlists, and Spotify's **Add to playlist** menu shows those playlists first in a "Suggested" section. No more searching for the Rap playlist every time you add a Drake song.

> **Status:** early development. Nothing is implemented yet. The v1 design is in [`docs/superpowers/specs/2026-10-11-smart-add-design.md`](docs/superpowers/specs/2026-10-11-smart-add-design.md).

## Planned (v1)

- Map an artist or podcast show to one or more playlists (e.g. Drake → Rap + R&B)
- "Suggested" section at the top of the Add to playlist modal, grouped by credited artist
- Set mappings from the artist/show right-click menu, the track right-click menu, or a settings modal
- Works for the "+" button on track rows and in the now-playing bar

The older right-click → Add to playlist submenu is not covered in v1.

## Installation

### Prerequisites

[Spicetify](https://spicetify.app/) must be installed and working.

### Steps

1. Clone this repository:
   ```bash
   git clone https://github.com/yusufaf/spicetify-smart-add.git
   ```

2. Copy `smart-add.js` to your Spicetify extensions folder:
   - **Windows:** `%APPDATA%\spicetify\Extensions\`
   - **macOS/Linux:** `~/.config/spicetify/Extensions/`

3. Enable it and apply:
   ```bash
   spicetify config extensions smart-add.js
   spicetify apply
   ```

## License

MIT
