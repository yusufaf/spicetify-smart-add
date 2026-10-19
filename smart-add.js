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
const SA_DEFAULT_CONFIG = { enabled: true, maxPerGroup: 5, showGroupHeaders: true };
//#endregion

//#region State
let saData = { version: SA_DATA_VERSION, mappings: {} };
let saConfig = { ...SA_DEFAULT_CONFIG };
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
//#endregion

//#region Mappings Store
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
  };
} else {
  saMain();
}
//#endregion

})();
