// NAME: Smart Add
// AUTHOR: yusufaf
// DESCRIPTION: Suggests your mapped playlists first in Spotify's Add to playlist menu
//
// Smart Add moved to https://github.com/yusufaf/spicetify-extensions/tree/main/extensions/smart-add
// This file only loads it from there, so installs from this repository keep updating.
// Install it from the new location to stop depending on this redirect.

(function () {
  if (window.__smartAddActive) return;
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/gh/yusufaf/spicetify-extensions@main/extensions/smart-add/smart-add.js';
  script.onerror = () => console.error('[Smart Add] Could not load the extension from https://cdn.jsdelivr.net/gh/yusufaf/spicetify-extensions@main/extensions/smart-add/smart-add.js');
  document.head.appendChild(script);
})();
