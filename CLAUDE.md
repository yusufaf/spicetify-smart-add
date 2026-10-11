# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Spicetify (Spotify desktop client) extension: `smart-add.js`. No build step, no bundler, no runtime dependencies. The whole extension is one IIFE running in Spotify's `xpui` renderer. It adds a "Suggested" section to the native Add to playlist modal, driven by artist/show → playlist mappings.

The v1 design, decisions, and spike findings are in `docs/superpowers/specs/2026-10-11-smart-add-design.md`. Read it before changing the injector.

## Commands

```bash
pnpm test        # node --check smart-add.js — syntax gate, the only automated test
```

- Package manager is **pnpm** (pinned via `packageManager`).
- Husky: `pre-commit` runs `pnpm test`; `commit-msg` runs commitlint (Conventional Commits — release-please derives versions from them).

## Live testing

Behavior only exists inside Spotify. Use the `spicetify-live-test` skill (CDP). `tests.live.md` has the smoke test and scenarios. Debug output is prefixed `[Smart Add]`.

The repo is not symlinked into Spicetify (hardlinks/symlinks are unsafe here). Copy `smart-add.js` into both `%APPDATA%\spicetify\Extensions\` and `%APPDATA%\Spotify\Apps\xpui\extensions\` after each edit, then reload via CDP. Re-copy after any `spicetify apply`.

## Architecture

Organized into `//#region` blocks, in this order: Constants, State, Storage, Platform Helpers, Mappings Store, Trigger Capture, Modal Injector, Mapping Editor, Context Menus, Settings, Styles, Bootstrap. Keep new code in the matching region.

Key invariants:

- **Never break the native modal.** Every injector/render path is wrapped in try/catch and logs with `[Smart Add]`. If injection fails, the native Add to playlist modal must still work.
- **Anchor on structure, not text or hashed classes.** The modal is a `form` containing `input[role=searchbox]` and `ul[role=menu]`. The older right-click submenu in `#context-menu` also has a searchbox but is not a `form` and is out of scope for v1.
- **Persistence is `Spicetify.LocalStorage` only**, keys `smart-add-data` and `smart-add-config`. Mappings are keyed by artist/show URI; names are display caches.
- **Re-entrant.** The modal form is recreated on every open and React re-renders it often. Dedupe on the form node and re-inject if our node is removed.
- **Wrong suggestions are worse than none.** Inject only when the trigger capture is fresh and sources resolved in time.

## Versioning

Version lives in `package.json` and the `// VERSION:` banner in `smart-add.js` (inside `x-release-please` markers), kept in sync by release-please. Don't bump by hand; land Conventional Commits.

## Style

- JSDoc comments on functions.
- `SA_` constant prefix, `sa-` CSS class / DOM id prefix.
- CSS must not hardcode colors; use Spicetify theme variables.
- Update `CHANGELOG.md` only via release-please.
