// NAME: Smart Add
// AUTHOR: yusufaf
// x-release-please-start-version
// VERSION: 0.0.0
// x-release-please-end-version
// DESCRIPTION: Suggests your mapped playlists first in Spotify's Add to playlist menu

(function () {
'use strict';

//#region Constants
const SA_LOG = '[Smart Add]';
const SA_DATA_KEY = 'smart-add-data';
const SA_CONFIG_KEY = 'smart-add-config';
const SA_DATA_BACKUP_KEY = 'smart-add-data-backup';
const SA_DATA_VERSION = 1;
const SA_MAX_GROUPS = 3;
const SA_CAPTURE_WINDOW_MS = 2000;
const SA_FIBER_DEPTH = 20;
const SA_READY_TIMEOUT_MS = 300;
const SA_PLAYLIST_CACHE_MS = 30_000;
const SA_SOURCE_CACHE_SIZE = 200;
const SA_DEFAULT_CONFIG = { enabled: true, maxPerGroup: 5, showGroupHeaders: true };
//#endregion

//#region State
let saData = { version: SA_DATA_VERSION, mappings: {} };
let saConfig = { ...SA_DEFAULT_CONFIG };
let saPlaylistCache = null;
let saPlaylistCacheAt = 0;
let saPlaylistInflight = null;
const saSourceCache = saCreateLru(SA_SOURCE_CACHE_SIZE);
/** @type {Capture|null} */
let saCapture = null;
//#endregion

//#region Storage
/**
 * Default, empty mappings data.
 * @returns {{version: number, mappings: Object}}
 */
function saDefaultData() {
  return { version: SA_DATA_VERSION, mappings: {} };
}

/**
 * Parses the stored mappings data.
 * @param {string|null} raw
 * @returns {{data: {version: number, mappings: Object}, corrupt: boolean}}
 */
function saParseData(raw) {
  if (raw == null) return { data: saDefaultData(), corrupt: false };
  try {
    const parsed = JSON.parse(raw);
    const mappings = parsed?.mappings;
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
      return { data: saDefaultData(), corrupt: true };
    }
    return { data: { version: SA_DATA_VERSION, mappings }, corrupt: false };
  } catch {
    return { data: saDefaultData(), corrupt: true };
  }
}

/**
 * Parses the stored config, merged over defaults.
 * @param {string|null} raw
 * @returns {{enabled: boolean, maxPerGroup: number, showGroupHeaders: boolean}}
 */
function saParseConfig(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') return { ...SA_DEFAULT_CONFIG, ...parsed };
  } catch {}
  return { ...SA_DEFAULT_CONFIG };
}

/**
 * Loads data and config into module state, backing up corrupt data first.
 */
function saLoad() {
  const raw = Spicetify.LocalStorage.get(SA_DATA_KEY);
  const { data, corrupt } = saParseData(raw);
  if (corrupt) {
    Spicetify.LocalStorage.set(SA_DATA_BACKUP_KEY, raw);
    console.warn(`${SA_LOG} Stored data was unreadable; reset it and kept a copy in ${SA_DATA_BACKUP_KEY}`);
  }
  saData = data;
  saConfig = saParseConfig(Spicetify.LocalStorage.get(SA_CONFIG_KEY));
}

/** Writes mappings data to storage. */
function saSaveData() {
  Spicetify.LocalStorage.set(SA_DATA_KEY, JSON.stringify(saData));
}

/** Writes config to storage. */
function saSaveConfig() {
  Spicetify.LocalStorage.set(SA_CONFIG_KEY, JSON.stringify(saConfig));
}
//#endregion

//#region Platform Helpers
/**
 * @typedef {{uri: string, name: string, kind: 'artist'|'show'}} Source
 */

/**
 * Flattens the rootlist tree into the playlists the user can add to.
 * @param {Object|null} node RootlistAPI.getContents() result
 * @returns {Array<{uri: string, name: string, image: string}>}
 */
function saFlattenRootlist(node) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'playlist' && n.canAdd === true && n.uri) {
      out.push({ uri: n.uri, name: n.name || '', image: n.images?.[0]?.url || '' });
    }
    for (const child of n.items || n.rows || n.children || []) walk(child);
  };
  walk(node);
  return out;
}

/**
 * Returns the playlists the user can add to. Cached for 30s, concurrent calls share one request.
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<Array<{uri: string, name: string, image: string}>>}
 */
async function saGetPlaylists(opts = {}) {
  if (!opts.force && saPlaylistCache && Date.now() - saPlaylistCacheAt < SA_PLAYLIST_CACHE_MS) {
    return saPlaylistCache;
  }
  if (saPlaylistInflight) return saPlaylistInflight;
  saPlaylistInflight = (async () => {
    try {
      const root = await Spicetify.Platform.RootlistAPI.getContents();
      saPlaylistCache = saFlattenRootlist(root);
      saPlaylistCacheAt = Date.now();
    } catch (err) {
      console.error(`${SA_LOG} Failed to read playlists`, err);
    } finally {
      saPlaylistInflight = null;
    }
    return saPlaylistCache || [];
  })();
  return saPlaylistInflight;
}

/** Marks the playlist cache stale when the library changes, so new playlists show up right away. */
function saWatchRootlist() {
  Spicetify.Platform.RootlistAPI.getEvents?.()?.addListener?.('update', () => {
    saPlaylistCacheAt = 0;
  });
}

/**
 * Removes deleted playlists from stored mappings, using a fresh library read. Skips on failure.
 * @returns {Promise<void>}
 */
async function saPruneStored() {
  try {
    const playlists = saFlattenRootlist(await Spicetify.Platform.RootlistAPI.getContents());
    saPlaylistCache = playlists;
    saPlaylistCacheAt = Date.now();
    const { mappings, removed } = saPruneMappings(saData.mappings, new Set(playlists.map((p) => p.uri)));
    if (!removed) return;
    saData.mappings = mappings;
    saSaveData();
    console.log(`${SA_LOG} Removed ${removed} deleted playlist(s) from mappings`);
  } catch (err) {
    console.warn(`${SA_LOG} Skipped cleanup; couldn't read playlists`, err);
  }
}

/**
 * Extracts credited artists from a GraphQL trackUnion, primary artist first.
 * @param {Object|undefined} trackUnion
 * @returns {Source[]}
 */
function saTrackArtists(trackUnion) {
  const items = [...(trackUnion?.firstArtist?.items || []), ...(trackUnion?.otherArtists?.items || [])];
  return saDedupeSources(items
    .filter((a) => a?.uri)
    .map((a) => ({ uri: a.uri, name: a.profile?.name || '', kind: 'artist' })));
}

/**
 * Removes repeated sources, keeping the first occurrence.
 * @param {Source[]} sources
 * @returns {Source[]}
 */
function saDedupeSources(sources) {
  const seen = new Set();
  return sources.filter((s) => !seen.has(s.uri) && seen.add(s.uri));
}

/**
 * Creates a small least-recently-used cache.
 * @param {number} limit
 * @returns {{get: (key: string) => any, set: (key: string, value: any) => void}}
 */
function saCreateLru(limit) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      if (map.size > limit) map.delete(map.keys().next().value);
    },
  };
}

/**
 * Looks up the sources (artists or show) for one track or episode URI.
 * @param {string} uri
 * @returns {Promise<Source[]>}
 */
async function saFetchSources(uri) {
  const { Request, Definitions } = Spicetify.GraphQL;
  if (Spicetify.URI.isEpisode(uri)) {
    const res = await Request(Definitions.queryNpvEpisode, { uri });
    const show = res?.data?.episodeUnionV2?.podcastV2?.data;
    return show?.uri ? [{ uri: show.uri, name: show.name || '', kind: 'show' }] : [];
  }
  const res = await Request(Definitions.getTrack, { uri, locale: Spicetify.Locale?.getLocale?.() || 'en' });
  return saTrackArtists(res?.data?.trackUnion);
}

/**
 * Resolves track/episode URIs to their sources, in input order, deduped. Failed URIs contribute nothing.
 * @param {string[]} uris
 * @returns {Promise<Source[]>}
 */
async function saResolveSources(uris) {
  const lists = await Promise.all(uris.map(async (uri) => {
    const cached = saSourceCache.get(uri);
    if (cached) return cached;
    try {
      const sources = await saFetchSources(uri);
      if (sources.length) saSourceCache.set(uri, sources);
      return sources;
    } catch (err) {
      console.warn(`${SA_LOG} Couldn't look up ${uri}`, err);
      return [];
    }
  }));
  return saDedupeSources(lists.flat());
}

/**
 * Sources for the now-playing item without a network request when possible.
 * @param {Object|undefined} item Spicetify.Player.data.item
 * @returns {Source[]}
 */
function saSourcesFromPlayerItem(item) {
  if (item?.show?.uri) return [{ uri: item.show.uri, name: item.show.name || '', kind: 'show' }];
  return saDedupeSources((item?.artists || [])
    .filter((a) => a?.uri)
    .map((a) => ({ uri: a.uri, name: a.name || '', kind: 'artist' })));
}
//#endregion

//#region Mappings Store
/**
 * @typedef {{kind: 'artist'|'show', name: string, playlists: string[], updatedAt: number}} Mapping
 */

/**
 * @param {string} sourceUri
 * @returns {Mapping|undefined}
 */
function saGetMapping(sourceUri) {
  return saData.mappings[sourceUri];
}

/**
 * Stores the playlists for a source. An empty list removes the mapping.
 * @param {Source} source
 * @param {string[]} playlistUris
 */
function saSetMapping(source, playlistUris) {
  if (!playlistUris.length) {
    saRemoveMapping(source.uri);
    return;
  }
  saData.mappings[source.uri] = { kind: source.kind, name: source.name, playlists: [...playlistUris], updatedAt: Date.now() };
  saSaveData();
}

/**
 * @param {string} sourceUri
 */
function saRemoveMapping(sourceUri) {
  delete saData.mappings[sourceUri];
  saSaveData();
}

/**
 * Drops playlists that are no longer in the user's library, then mappings left empty.
 * Does nothing when the library couldn't be read, so a failed fetch never wipes mappings.
 * @param {Object<string, Mapping>} mappings
 * @param {Set<string>} validUris
 * @returns {{mappings: Object<string, Mapping>, removed: number}}
 */
function saPruneMappings(mappings, validUris) {
  if (validUris.size === 0) return { mappings, removed: 0 };
  const out = {};
  let removed = 0;
  for (const [uri, m] of Object.entries(mappings)) {
    const playlists = m.playlists.filter((p) => validUris.has(p));
    removed += m.playlists.length - playlists.length;
    if (playlists.length) out[uri] = playlists.length === m.playlists.length ? m : { ...m, playlists };
  }
  return { mappings: out, removed };
}

/**
 * Builds the Suggested groups: one per source with a mapping, in source order.
 * A playlist mapped to several sources appears once, under the earliest source.
 * Empty groups are dropped and at most SA_MAX_GROUPS groups are returned.
 * maxPerGroup caps unsaved rows only, so a saved row never hides a playlist the track could still go in.
 * @param {Source[]} sources
 * @param {Object<string, Mapping>} mappings
 * @param {Set<string>} savedInSet playlist URIs that already hold the track
 * @param {number} maxPerGroup
 * @returns {Array<{source: Source, rows: Array<{playlistUri: string, saved: boolean}>}>}
 */
function buildSuggestionGroups(sources, mappings, savedInSet, maxPerGroup) {
  const shown = new Set();
  const groups = [];
  for (const source of sources) {
    if (groups.length >= SA_MAX_GROUPS) break;
    const rows = [];
    let unsaved = 0;
    for (const playlistUri of mappings[source.uri]?.playlists || []) {
      if (shown.has(playlistUri)) continue;
      const saved = savedInSet.has(playlistUri);
      if (!saved && unsaved >= maxPerGroup) continue;
      if (!saved) unsaved += 1;
      shown.add(playlistUri);
      rows.push({ playlistUri, saved });
    }
    if (rows.length) groups.push({ source, rows });
  }
  return groups;
}
//#endregion

//#region Trigger Capture
/**
 * @typedef {{uris: string[], at: number, sources: Promise<Source[]>, used: boolean}} Capture
 */

/**
 * Whether a capture can drive suggestions for a modal opening now.
 * @param {Capture|null} capture
 * @param {number} now
 * @param {number} [windowMs]
 * @returns {boolean}
 */
function saIsFresh(capture, now, windowMs = SA_CAPTURE_WINDOW_MS) {
  if (!capture || capture.used) return false;
  const age = now - capture.at;
  return age >= 0 && age <= windowMs;
}

/**
 * Reads a tracklist row's track/episode URI from React's props. The row DOM carries no URI.
 * @param {Element|null} row element with role=row
 * @returns {string|null}
 */
function saRowUri(row) {
  if (!row) return null;
  const key = Object.keys(row).find((k) => k.startsWith('__reactFiber$'));
  let fiber = key ? row[key] : null;
  for (let depth = 0; fiber && depth < SA_FIBER_DEPTH; depth += 1, fiber = fiber.return) {
    const uri = fiber.memoizedProps?.uri;
    if (typeof uri === 'string' && /^spotify:(track|episode):/.test(uri)) return uri;
  }
  return null;
}

/**
 * Records what a click on a row or now-playing save/add button refers to.
 * The same button saves to Liked Songs or opens the Add to playlist modal, so every click is
 * recorded and the modal injector decides whether a capture is fresh enough to use.
 * @param {MouseEvent} event
 */
function saOnClickCapture(event) {
  try {
    const target = /** @type {Element} */ (event.target);
    if (target.closest?.('#context-menu')) {
      saCapture = null;
      return;
    }
    const button = target.closest?.('button[aria-checked]');
    if (!button || button.closest('form, [role=menu]')) return;
    const row = button.closest('[role=row]');
    if (row) {
      // Episode rows keep the URI closer to the button than to the row element.
      const uri = saRowUri(button) || saRowUri(row);
      if (uri) saCapture = { uris: [uri], at: Date.now(), sources: saResolveSources([uri]), used: false };
      saGetPlaylists();
      return;
    }
    if (button.closest('[data-testid=now-playing-widget], #Desktop_PanelContainer_Id')) {
      const item = Spicetify.Player.data?.item;
      if (!item?.uri) return;
      const direct = saSourcesFromPlayerItem(item);
      const sources = direct.length ? Promise.resolve(direct) : saResolveSources([item.uri]);
      saCapture = { uris: [item.uri], at: Date.now(), sources, used: false };
      saGetPlaylists();
    }
  } catch (err) {
    console.error(`${SA_LOG} Click capture failed`, err);
  }
}

/** Installs the capture-phase click listener. */
function saInstallCapture() {
  document.addEventListener('click', saOnClickCapture, true);
}
//#endregion

//#region Modal Injector
/**
 * @typedef {{capture: Capture, section: HTMLElement, blocked: Set<string>, blockStyle: HTMLStyleElement, dead: boolean}} FormState
 */

/** Forms already seen, so the observer handles each modal once. */
const saHandledForms = new WeakSet();
/** @type {WeakMap<HTMLFormElement, FormState>} */
const saFormState = new WeakMap();
let saScanQueued = false;

/**
 * Reads the playlist URI off a native modal row's aria-labelledby.
 * @param {string|null} attr
 * @returns {string|null}
 */
function saPlaylistUriFromLabelledBy(attr) {
  const match = /(?:^|\s)listrow-title-(spotify:playlist:[A-Za-z0-9]+)(?:\s|$)/.exec(attr || '');
  return match ? match[1] : null;
}

/**
 * Playlist URI of a native modal row. Spotify labels the row from a child element.
 * @param {Element} button button[role=menuitemcheckbox]
 * @returns {string|null}
 */
function saNativeRowUri(button) {
  const labelled = button.querySelector('[aria-labelledby^="listrow-title-"]');
  return saPlaylistUriFromLabelledBy(labelled?.getAttribute('aria-labelledby') ?? button.getAttribute('aria-labelledby'));
}

/**
 * Resolves to the promise's value, or null if it takes longer than ms.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T|null>}
 */
function saWithin(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * @param {Element} form
 * @returns {boolean}
 */
function saIsAddModal(form) {
  return Boolean(form.querySelector('input[role=searchbox]') && form.querySelector('ul[role=menu]'));
}

/**
 * Native rows in the modal, keyed by playlist URI.
 * @param {HTMLFormElement} form
 * @returns {Map<string, HTMLButtonElement>}
 */
function saNativeRows(form) {
  const rows = new Map();
  for (const button of form.querySelectorAll('button[role=menuitemcheckbox]')) {
    const uri = saNativeRowUri(button);
    if (uri) rows.set(uri, button);
  }
  return rows;
}

/**
 * Resolves once the modal has rendered its playlist rows.
 * @param {HTMLFormElement} form
 * @returns {Promise<void>}
 */
async function saWaitForNativeRows(form) {
  while (form.isConnected && !form.querySelector('button[role=menuitemcheckbox]')) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

/**
 * Mirrors each rendered native row's checked state onto our row for the same playlist,
 * so ✓ stays right as the modal loads and as the user ticks native rows.
 * @param {HTMLFormElement} form
 * @param {FormState} state
 */
function saSyncSaved(form, state) {
  const native = saNativeRows(form);
  for (const button of state.section.querySelectorAll('.sa-row')) {
    if (button.dataset.busy || state.blocked.has(button.dataset.uri)) continue;
    const twin = native.get(button.dataset.uri);
    if (twin) saSetSaved(button, twin.getAttribute('aria-checked') === 'true');
  }
}

/** Observes the DOM for the Add to playlist modal. */
function saInstallInjector() {
  new MutationObserver(() => {
    if (saScanQueued) return;
    saScanQueued = true;
    requestAnimationFrame(() => {
      saScanQueued = false;
      saScan();
    });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-checked'] });
}

/** Injects into new modals and re-inserts our section if React removed it. */
function saScan() {
  try {
    for (const form of document.querySelectorAll('form')) {
      if (!saIsAddModal(form)) continue;
      if (!saHandledForms.has(form)) {
        saHandledForms.add(form);
        saInjectInto(form);
        continue;
      }
      const state = saFormState.get(form);
      if (!state || state.dead) continue;
      saSyncSaved(form, state);
      if (state.section.isConnected) continue;
      try {
        const list = form.querySelector('ul[role=menu]');
        list.parentElement.insertBefore(state.section, list);
      } catch (err) {
        state.dead = true;
        console.error(`${SA_LOG} Couldn't re-insert suggestions; leaving this modal alone`, err);
      }
    }
  } catch (err) {
    console.error(`${SA_LOG} Scan failed`, err);
  }
}

/**
 * Adds the Suggested section to a freshly opened modal, if the capture that opened it is fresh.
 * @param {HTMLFormElement} form
 */
async function saInjectInto(form) {
  try {
    if (!saConfig.enabled) return;
    const capture = saCapture;
    if (!saIsFresh(capture, Date.now())) return;
    capture.used = true;
    // Native rows carry the "already saved" state, so wait for them too, all within one budget.
    const ready = await saWithin(
      Promise.all([capture.sources, saGetPlaylists(), saWaitForNativeRows(form)]),
      SA_READY_TIMEOUT_MS,
    );
    if (!ready || !form.isConnected) return;
    const [sources, playlists] = ready;
    if (!sources.length) return;

    // Hide playlists we can't find, but only delete them from storage after a fresh fetch confirms it.
    const visible = saPruneMappings(saData.mappings, new Set(playlists.map((p) => p.uri)));
    if (visible.removed) saPruneStored();
    const saved = new Set([...saNativeRows(form)].filter(([, b]) => b.getAttribute('aria-checked') === 'true').map(([uri]) => uri));
    const groups = buildSuggestionGroups(sources, visible.mappings, saved, saConfig.maxPerGroup);
    if (!groups.length) return;

    const byUri = new Map(playlists.map((p) => [p.uri, p]));
    const blockStyle = document.createElement('style');
    /** @type {FormState} */
    const state = { capture, section: null, blocked: new Set(), blockStyle, dead: false };
    state.section = saRenderSection(form, groups, byUri, state);
    state.section.append(blockStyle);
    saFormState.set(form, state);
    const list = form.querySelector('ul[role=menu]');
    list.parentElement.insertBefore(state.section, list);
    saWireForm(form, state);
  } catch (err) {
    console.error(`${SA_LOG} Inject failed; the native modal is unaffected`, err);
  }
}

/**
 * Builds the Suggested section.
 * @param {HTMLFormElement} form
 * @param {ReturnType<typeof buildSuggestionGroups>} groups
 * @param {Map<string, {uri: string, name: string, image: string}>} byUri
 * @param {FormState} state
 * @returns {HTMLElement}
 */
function saRenderSection(form, groups, byUri, state) {
  const section = document.createElement('section');
  section.id = 'sa-suggested';
  section.className = 'sa-suggested';
  const header = (text) => {
    const el = document.createElement('div');
    el.className = 'sa-header';
    el.textContent = text;
    section.append(el);
  };
  if (!saConfig.showGroupHeaders) header('Suggested');
  for (const group of groups) {
    if (saConfig.showGroupHeaders) header(`Suggested · ${group.source.name}`);
    for (const row of group.rows) {
      section.append(saRenderRow(form, row, byUri.get(row.playlistUri), state));
    }
  }
  return section;
}

/**
 * @param {HTMLFormElement} form
 * @param {{playlistUri: string, saved: boolean}} row
 * @param {{name: string, image: string}} playlist
 * @param {FormState} state
 * @returns {HTMLButtonElement}
 */
function saRenderRow(form, row, playlist, state) {
  const name = playlist.name || 'Playlist';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sa-row';
  button.dataset.uri = row.playlistUri;
  const cover = document.createElement(playlist.image ? 'img' : 'span');
  cover.className = 'sa-row-cover';
  if (playlist.image) {
    cover.src = playlist.image;
    cover.alt = '';
  }
  const label = document.createElement('span');
  label.className = 'sa-row-name encore-text-body-medium';
  label.textContent = name;
  const mark = document.createElement('span');
  mark.className = 'sa-row-mark';
  button.append(cover, label, mark);
  saSetSaved(button, row.saved);
  button.addEventListener('click', () => saOnRowClick(form, button, row.playlistUri, name, state));
  return button;
}

/**
 * @param {HTMLButtonElement} button
 * @param {boolean} saved
 */
function saSetSaved(button, saved) {
  button.disabled = saved;
  button.classList.toggle('sa-row--saved', saved);
  button.querySelector('.sa-row-mark').textContent = saved ? '✓' : '';
}

/**
 * Adds the captured track(s) to a playlist, skipping any already in it.
 * @param {HTMLFormElement} form
 * @param {HTMLButtonElement} button
 * @param {string} playlistUri
 * @param {string} name
 * @param {FormState} state
 */
async function saOnRowClick(form, button, playlistUri, name, state) {
  button.disabled = true;
  button.dataset.busy = '1';
  try {
    const contents = await Spicetify.Platform.PlaylistAPI.getContents(playlistUri);
    const existing = new Set((contents?.items || []).map((item) => item.uri));
    const missing = state.capture.uris.filter((uri) => !existing.has(uri));
    if (!missing.length) {
      saSetSaved(button, true);
      Spicetify.showNotification(`Already in ${name}`);
      return;
    }
    if (saNativeRows(form).get(playlistUri)?.getAttribute('aria-checked') === 'true') {
      button.disabled = false;
      Spicetify.showNotification(`${name} is ticked below. Press Done to add it.`);
      return;
    }
    await Spicetify.Platform.PlaylistAPI.add(playlistUri, missing, { after: 'end' });
    saSetSaved(button, true);
    saBlockNativeRow(state, playlistUri);
    Spicetify.showNotification(`Added to ${name}`);
  } catch (err) {
    button.disabled = false;
    console.error(`${SA_LOG} Add to ${playlistUri} failed`, err);
    Spicetify.showNotification(`Couldn't add to ${name}`, true);
  } finally {
    delete button.dataset.busy;
  }
}

/**
 * Stops the native row for a playlist we just added to from adding the track again on Done.
 * @param {FormState} state
 * @param {string} playlistUri
 */
function saBlockNativeRow(state, playlistUri) {
  state.blocked.add(playlistUri);
  state.blockStyle.textContent = [...state.blocked]
    .map((uri) => `form button[role=menuitemcheckbox]:has([aria-labelledby="listrow-title-${uri}"])`)
    .join(',\n') + ' { opacity: 0.5; pointer-events: none; }';
}

/**
 * Hides the section while searching and swallows input on blocked native rows.
 * @param {HTMLFormElement} form
 * @param {FormState} state
 */
function saWireForm(form, state) {
  const search = form.querySelector('input[role=searchbox]');
  const syncSearch = () => {
    state.section.hidden = Boolean(search.value);
  };
  search.addEventListener('input', syncSearch);
  syncSearch();

  const swallow = (event) => {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const native = event.target.closest?.('button[role=menuitemcheckbox]');
    const uri = native && saNativeRowUri(native);
    if (uri && state.blocked.has(uri)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  form.addEventListener('click', swallow, true);
  form.addEventListener('keydown', swallow, true);
}
//#endregion

//#region Mapping Editor
/**
 * @param {Array<{uri: string, name: string, image: string}>} playlists
 * @param {string} query
 * @returns {Array<{uri: string, name: string, image: string}>}
 */
function saFilterPlaylists(playlists, query) {
  const q = query.trim().toLowerCase();
  return q ? playlists.filter((p) => p.name.toLowerCase().includes(q)) : playlists;
}

/**
 * The playlists to store after editing: still-checked ones keep their order, new ones follow in list order.
 * @param {string[]} previous
 * @param {Set<string>} checked
 * @param {string[]} listOrder
 * @returns {string[]}
 */
function saNextPlaylists(previous, checked, listOrder) {
  const kept = previous.filter((uri) => checked.has(uri));
  const added = listOrder.filter((uri) => checked.has(uri) && !kept.includes(uri));
  return [...kept, ...added];
}

/**
 * Opens the editor for one source's playlists.
 * @param {Source} source
 */
async function saOpenMappingEditor(source) {
  try {
    const playlists = await saGetPlaylists({ force: true });
    const previous = saGetMapping(source.uri)?.playlists || [];
    const checked = new Set(previous);
    const ordered = [
      ...previous.map((uri) => playlists.find((p) => p.uri === uri)).filter(Boolean),
      ...playlists.filter((p) => !checked.has(p.uri)),
    ];

    const root = document.createElement('div');
    root.className = 'sa-editor';
    const hint = document.createElement('p');
    hint.className = 'sa-editor-hint';
    hint.textContent = source.kind === 'show'
      ? `These playlists show up first when you add an episode of ${source.name}.`
      : `These playlists show up first when you add a song by ${source.name}.`;
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'sa-input';
    filter.placeholder = 'Filter playlists';
    const list = document.createElement('div');
    list.className = 'sa-editor-list';
    const empty = document.createElement('p');
    empty.className = 'sa-editor-hint';
    empty.textContent = playlists.length ? 'No playlists match.' : "You don't have any playlists you can add to yet.";

    const render = () => {
      list.replaceChildren();
      const shown = saFilterPlaylists(ordered, filter.value);
      for (const playlist of shown) {
        const label = document.createElement('label');
        label.className = 'sa-editor-row';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = checked.has(playlist.uri);
        box.addEventListener('change', () => {
          if (box.checked) checked.add(playlist.uri);
          else checked.delete(playlist.uri);
        });
        const cover = document.createElement(playlist.image ? 'img' : 'span');
        cover.className = 'sa-row-cover';
        if (playlist.image) {
          cover.src = playlist.image;
          cover.alt = '';
        }
        const name = document.createElement('span');
        name.className = 'sa-row-name';
        name.textContent = playlist.name;
        label.append(box, cover, name);
        list.append(label);
      }
      if (!shown.length) list.append(empty);
    };
    filter.addEventListener('input', render);
    render();

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'sa-button sa-button--primary';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      saSetMapping(source, saNextPlaylists(previous, checked, ordered.map((p) => p.uri)));
      Spicetify.PopupModal.hide();
      Spicetify.showNotification(checked.size ? `Saved playlists for ${source.name}` : `Removed playlists for ${source.name}`);
    });
    const footer = document.createElement('div');
    footer.className = 'sa-editor-footer';
    footer.append(save);

    root.append(hint, filter, list, footer);
    Spicetify.PopupModal.display({ title: `Playlists for ${source.name}`, content: root, isLarge: true });
    filter.focus();
  } catch (err) {
    console.error(`${SA_LOG} Couldn't open the mapping editor`, err);
    Spicetify.showNotification("Couldn't open Smart Add", true);
  }
}

/**
 * Asks which credited artist to map when a track has several, then opens the editor.
 * @param {Source[]} sources
 */
function saPickSource(sources) {
  const root = document.createElement('div');
  root.className = 'sa-editor';
  const hint = document.createElement('p');
  hint.className = 'sa-editor-hint';
  hint.textContent = 'This song has more than one artist. Which one do you want to map?';
  root.append(hint);
  for (const source of sources) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sa-button sa-pick';
    button.textContent = source.name;
    button.addEventListener('click', () => saOpenMappingEditor(source));
    root.append(button);
  }
  Spicetify.PopupModal.display({ title: 'Choose an artist', content: root });
}
//#endregion

//#region Context Menus
/**
 * Looks up the display name for an artist or show URI.
 * @param {string} uri
 * @returns {Promise<Source>}
 */
async function saSourceFromUri(uri) {
  if (Spicetify.URI.isShow(uri)) {
    const meta = await Spicetify.Platform.ShowAPI.getMetadata(uri);
    return { uri, name: meta?.name || 'this show', kind: 'show' };
  }
  const res = await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.queryArtistOverview, {
    uri,
    locale: Spicetify.Locale?.getLocale?.() || 'en',
    includePrerelease: false,
  });
  return { uri, name: res?.data?.artistUnion?.profile?.name || 'this artist', kind: 'artist' };
}

/**
 * Opens the editor for a track's or episode's source, asking first if a track has several artists.
 * @param {string} uri
 */
async function saMapFromItem(uri) {
  const sources = await saResolveSources([uri]);
  if (!sources.length) {
    Spicetify.showNotification("Couldn't find who made this", true);
    return;
  }
  if (sources.length === 1) saOpenMappingEditor(sources[0]);
  else saPickSource(sources);
}

/** Registers the right-click entries for artists, shows, tracks and episodes. */
function saRegisterContextMenus() {
  const single = (uris, test) => uris.length === 1 && test(uris[0]);
  new Spicetify.ContextMenu.Item(
    'Smart Add playlists…',
    async ([uri]) => {
      try {
        saOpenMappingEditor(await saSourceFromUri(uri));
      } catch (err) {
        console.error(`${SA_LOG} Couldn't look up ${uri}`, err);
        Spicetify.showNotification("Couldn't open Smart Add", true);
      }
    },
    (uris) => single(uris, (u) => Spicetify.URI.isArtist(u) || Spicetify.URI.isShow(u)),
    'playlist',
  ).register();
  new Spicetify.ContextMenu.Item(
    'Map artist to playlists…',
    ([uri]) => saMapFromItem(uri),
    (uris) => single(uris, (u) => Spicetify.URI.isTrack(u)),
    'playlist',
  ).register();
  new Spicetify.ContextMenu.Item(
    'Map show to playlists…',
    ([uri]) => saMapFromItem(uri),
    (uris) => single(uris, (u) => Spicetify.URI.isEpisode(u)),
    'playlist',
  ).register();
}
//#endregion

//#region Settings
/**
 * Serializes data and config as an export file.
 * @param {{version: number, mappings: Object}} data
 * @param {Object} config
 * @returns {string}
 */
function saExportText(data, config) {
  return JSON.stringify({ app: 'smart-add', data, config }, null, 2);
}

/**
 * Parses an export file. Throws if it isn't a valid Smart Add export.
 * @param {string} text
 * @returns {{data: {version: number, mappings: Object}, config: Object}}
 */
function saParseImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (parsed?.app !== 'smart-add') throw new Error('Not a Smart Add export');
  const { data, corrupt } = saParseData(JSON.stringify(parsed.data ?? null));
  if (corrupt || !parsed.data) throw new Error('Not a Smart Add export');
  return { data, config: saParseConfig(JSON.stringify(parsed.config ?? null)) };
}

/** Adds "Smart Add" to the profile menu. */
function saRegisterSettings() {
  if (!Spicetify.Menu?.Item) return;
  new Spicetify.Menu.Item('Smart Add', false, saOpenSettings).register();
}

/**
 * Builds a labelled settings control row.
 * @param {string} text
 * @param {HTMLElement} control
 * @returns {HTMLLabelElement}
 */
function saSettingRow(text, control) {
  const label = document.createElement('label');
  label.className = 'sa-setting';
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, control);
  return label;
}

/** Opens the settings modal: options, the mappings table, and export/import. */
function saOpenSettings() {
  const root = document.createElement('div');
  root.className = 'sa-editor sa-settings';

  const toggle = (key) => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(saConfig[key]);
    box.addEventListener('change', () => {
      saConfig = { ...saConfig, [key]: box.checked };
      saSaveConfig();
    });
    return box;
  };
  const max = document.createElement('input');
  max.type = 'number';
  max.min = '1';
  max.max = '10';
  max.className = 'sa-input sa-number';
  max.value = String(saConfig.maxPerGroup);
  max.addEventListener('change', () => {
    const n = Math.min(10, Math.max(1, parseInt(max.value, 10) || SA_DEFAULT_CONFIG.maxPerGroup));
    max.value = String(n);
    saConfig = { ...saConfig, maxPerGroup: n };
    saSaveConfig();
  });

  const heading = (text) => {
    const h = document.createElement('h3');
    h.className = 'sa-settings-heading';
    h.textContent = text;
    return h;
  };

  const table = document.createElement('div');
  table.className = 'sa-editor-list';
  const renderTable = () => {
    table.replaceChildren();
    const entries = Object.entries(saData.mappings).sort(([, a], [, b]) => a.name.localeCompare(b.name));
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'sa-editor-hint';
      empty.textContent = 'No mappings yet. Right-click an artist, song, show or episode and choose a Smart Add option.';
      table.append(empty);
    }
    for (const [uri, mapping] of entries) {
      const row = document.createElement('div');
      row.className = 'sa-mapping';
      const name = document.createElement('span');
      name.className = 'sa-row-name';
      name.textContent = mapping.name;
      const meta = document.createElement('span');
      meta.className = 'sa-mapping-meta';
      const count = mapping.playlists.length;
      meta.textContent = `${mapping.kind === 'show' ? 'Show' : 'Artist'} · ${count} playlist${count === 1 ? '' : 's'}`;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'sa-button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => saOpenMappingEditor({ uri, name: mapping.name, kind: mapping.kind }));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sa-button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        saRemoveMapping(uri);
        renderTable();
      });
      row.append(name, meta, edit, remove);
      table.append(row);
    }
  };
  renderTable();

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'sa-button';
  exportButton.textContent = 'Export';
  exportButton.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([saExportText(saData, saConfig)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-add-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    Spicetify.showNotification('Exported Smart Add mappings');
  });

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.hidden = true;
  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'sa-button';
  importButton.textContent = 'Import';
  importButton.addEventListener('click', () => file.click());
  const confirmRow = document.createElement('div');
  confirmRow.className = 'sa-confirm';
  confirmRow.hidden = true;
  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    file.value = '';
    if (!picked) return;
    try {
      const imported = saParseImport(await picked.text());
      const n = Object.keys(imported.data.mappings).length;
      const text = document.createElement('span');
      text.textContent = `Replace your ${Object.keys(saData.mappings).length} mapping(s) with ${n} from ${picked.name}?`;
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'sa-button sa-button--primary';
      replace.textContent = 'Replace';
      replace.addEventListener('click', () => {
        saData = imported.data;
        saConfig = imported.config;
        saSaveData();
        saSaveConfig();
        Spicetify.PopupModal.hide();
        Spicetify.showNotification(`Imported ${n} mapping(s)`);
      });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'sa-button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        confirmRow.hidden = true;
      });
      confirmRow.replaceChildren(text, replace, cancel);
      confirmRow.hidden = false;
    } catch (err) {
      Spicetify.showNotification(`Import failed: ${err.message}`, true);
    }
  });
  const actions = document.createElement('div');
  actions.className = 'sa-editor-footer';
  actions.append(exportButton, importButton, file);

  root.append(
    heading('Options'),
    saSettingRow('Show suggestions in Add to playlist', toggle('enabled')),
    saSettingRow('Show a header per artist or show', toggle('showGroupHeaders')),
    saSettingRow('Suggestions per artist or show', max),
    heading('Mappings'),
    table,
    actions,
    confirmRow,
  );
  Spicetify.PopupModal.display({ title: 'Smart Add', content: root, isLarge: true });
}
//#endregion

//#region Styles
/** Adds the extension's stylesheet once. */
function saInjectStyles() {
  if (document.getElementById('sa-styles')) return;
  const style = document.createElement('style');
  style.id = 'sa-styles';
  style.textContent = `
    .sa-suggested {
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      padding: 4px 0 8px;
      margin: 0 8px 4px;
      border-bottom: 1px solid rgba(var(--spice-rgb-subtext), 0.2);
    }
    .sa-suggested[hidden] { display: none; }
    .sa-header {
      padding: 8px 8px 4px;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--spice-subtext);
    }
    .sa-row {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 4px 8px;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--spice-text);
      font: inherit;
      font-size: 0.875rem;
      text-align: left;
      cursor: pointer;
    }
    .sa-row:hover:not(:disabled),
    .sa-row:focus-visible { background: rgba(var(--spice-rgb-text), 0.1); }
    .sa-row:disabled { cursor: default; }
    .sa-row-cover {
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: 4px;
      object-fit: cover;
      background: rgba(var(--spice-rgb-text), 0.1);
    }
    .sa-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sa-row-mark { color: var(--spice-button); font-weight: 700; }

    .sa-editor { display: flex; flex-direction: column; gap: 12px; }
    .sa-editor-hint { margin: 0; color: var(--spice-subtext); font-size: 0.875rem; }
    .sa-input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid rgba(var(--spice-rgb-subtext), 0.4);
      border-radius: 4px;
      background: rgba(var(--spice-rgb-text), 0.07);
      color: var(--spice-text);
      font: inherit;
    }
    .sa-editor-list {
      display: flex;
      flex-direction: column;
      max-height: min(45vh, 440px);
      overflow-y: auto;
    }
    .sa-editor-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 8px;
      border-radius: 4px;
      color: var(--spice-text);
      cursor: pointer;
    }
    .sa-editor-row:hover { background: rgba(var(--spice-rgb-text), 0.1); }
    .sa-editor-row input { accent-color: var(--spice-button); width: 16px; height: 16px; }
    .sa-editor-footer { display: flex; justify-content: flex-end; gap: 8px; }
    .sa-button {
      padding: 8px 20px;
      border: 1px solid rgba(var(--spice-rgb-subtext), 0.5);
      border-radius: 999px;
      background: transparent;
      color: var(--spice-text);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .sa-button:hover { border-color: var(--spice-text); }
    .sa-button--primary { border-color: var(--spice-button); background: var(--spice-button); color: var(--spice-main); }
    .sa-button--primary:hover { background: var(--spice-button-active); border-color: var(--spice-button-active); }
    .sa-pick { text-align: left; border-radius: 4px; }
    .sa-settings-heading { margin: 8px 0 0; font-size: 1rem; color: var(--spice-text); }
    .sa-setting {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      color: var(--spice-text);
    }
    .sa-setting input[type=checkbox] { accent-color: var(--spice-button); width: 16px; height: 16px; }
    .sa-number { width: 72px; }
    .sa-mapping {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 8px;
      border-radius: 4px;
      color: var(--spice-text);
    }
    .sa-mapping:hover { background: rgba(var(--spice-rgb-text), 0.1); }
    .sa-mapping-meta { color: var(--spice-subtext); font-size: 0.8125rem; white-space: nowrap; }
    .sa-mapping .sa-button { padding: 4px 12px; font-size: 0.8125rem; }
    .sa-confirm { display: flex; align-items: center; gap: 8px; color: var(--spice-text); }
    .sa-confirm[hidden] { display: none; }

    /* Spicetify's isLarge PopupModal fills the viewport whatever the content; cap only our modals. */
    .main-embedWidgetGenerator-container:has(.sa-editor) {
      height: auto !important;
      max-height: min(80vh, 720px) !important;
    }
    .main-trackCreditsModal-mainSection:has(.sa-editor) { overflow-y: auto !important; }
  `;
  document.head.append(style);
}
//#endregion

//#region Bootstrap
function saReady() {
  return Boolean(
    Spicetify?.LocalStorage &&
    Spicetify?.Platform?.PlaylistAPI &&
    Spicetify?.Platform?.RootlistAPI &&
    Spicetify?.ContextMenu &&
    Spicetify?.GraphQL
  );
}

async function saMain() {
  while (!saReady()) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(`${SA_LOG} Starting...`);
  saLoad();
  saInjectStyles();
  saInstallCapture();
  saInstallInjector();
  saWatchRootlist();
  saRegisterContextMenus();
  saRegisterSettings();
  saPruneStored();
  console.log(`${SA_LOG} Initialized`);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    saParseData,
    saParseConfig,
    saFlattenRootlist,
    saTrackArtists,
    saCreateLru,
    saPruneMappings,
    buildSuggestionGroups,
    saIsFresh,
    saRowUri,
    saPlaylistUriFromLabelledBy,
    saNativeRowUri,
    saFilterPlaylists,
    saNextPlaylists,
    saExportText,
    saParseImport,
  };
} else {
  saMain();
}
//#endregion

})();
