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
const SA_DATA_VERSION = 1;
const SA_DEFAULT_CONFIG = { enabled: true, maxPerGroup: 5, showGroupHeaders: true };
//#endregion

//#region State
let saData = { version: SA_DATA_VERSION, mappings: {} };
let saConfig = { ...SA_DEFAULT_CONFIG };
//#endregion

//#region Storage
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
  console.log(`${SA_LOG} Initialized`);
}

saMain();
//#endregion

})();
