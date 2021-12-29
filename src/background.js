/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


browser.runtime.onInstalled.addListener(async (aInstall) => {
  if (aInstall.reason == "install") {
    log("Read Next: Extension installed.");

    await setDefaultPrefs();
    init();
  }
});

browser.runtime.onStartup.addListener(() => {
  log("Read Next: Initializing extension during browser startup.");
  init();
});


async function setDefaultPrefs()
{
  let defaultPrefs = aePrefs.getDefaultPrefs();
  await aePrefs.setPrefs(defaultPrefs);
}


async function init()
{
  aeReadingList.init();

  let syncEnabled = await aePrefs.getPref("syncEnabled");
  if (syncEnabled) {
    // TO DO: Sync local reading list data with remote sync data.
  }
}


async function firstInitSync()
{
  let prefs = await aePrefs.getAllPrefs();
  let oauthClient = new aeOAuthClient(prefs.accessToken, prefs.refreshToken);
  let syncBacknd = Number(prefs.syncBackend);
  
  aeSyncReadingList.init(syncBacknd, oauthClient);
  await aeSyncReadingList.firstSync();

  browser.runtime.sendMessage({id: "reload-bookmarks-event"});
}



//
// Event handlers
//

browser.runtime.onMessage.addListener(async (aMessage) => {
  log(`Read Next: Background script received extension message "${aMessage.id}"`);

  switch (aMessage.id) {
  case "add-bookmark":
    let bookmarkID;
    try {
      bookmarkID = await aeReadingList.add(aMessage.bookmark);
    }
    catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(bookmarkID);

  case "remove-bookmark":
    aeReadingList.remove(aMessage.bookmarkID);
    break;

  case "get-all-bookmarks":
    let bookmarks = await aeReadingList.getAll();
    return Promise.resolve(bookmarks);

  case "sync-setting-changed":
    if (aMessage.syncEnabled) {
      warn("Read Next: Sync was turned ON from extension preferences.");
      firstInitSync();
    }
    else {
      warn("Read Next: Sync was turned OFF from extension preferences.");
    }
    break;
    
  default:
    break;
  }
});


//
// Utilities
//

function log(aMessage)
{
  if (aeConst.DEBUG) { console.log(aMessage) }
}


function warn(aMessage)
{
  if (aeConst.DEBUG) { console.warn(aMessage) }
}
