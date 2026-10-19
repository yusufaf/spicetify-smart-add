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
 * @returns {Array<{uri: string, name: string}>}
 */
function saFlattenRootlist(node) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'playlist' && n.canAdd === true && n.uri) {
      out.push({ uri: n.uri, name: n.name || '' });
    }
    for (const child of n.items || n.rows || n.children || []) walk(child);
  };
  walk(node);
  return out;
}

/**
 * Returns the playlists the user can add to. Cached for 30s, concurrent calls share one request.
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<Array<{uri: string, name: string}>>}
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
//#endregion

//#region Modal Injector
//#endregion

//#region Mapping Editor
//#endregion

//#region Context Menus
//#endregion

//#region Settings
//#endregion

//#region Styles
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
  };
} else {
  saMain();
}
//#endregion

})();
