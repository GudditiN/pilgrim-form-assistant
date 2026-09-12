'use strict';

/**
 * Minimal service worker. Pilgrim Form Assistant makes no network requests
 * and does not fetch or execute any remote code - all logic ships inside
 * this extension package.
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('Pilgrim Form Assistant installed.');
});
