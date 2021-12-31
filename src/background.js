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
    info("Read Next: Synced reading list is enabled.");
    
    await syncReadingList();

    // TO DO: Set up sync interval.
  }
}


async function firstSyncReadingList()
{
  let prefs = await aePrefs.getAllPrefs();
  let oauthClient = new aeOAuthClient(prefs.accessToken, prefs.refreshToken);
  let syncBacknd = Number(prefs.syncBackend);
  
  aeSyncReadingList.init(syncBacknd, oauthClient);

  log("Read Next: Starting reading list sync...");
  await aeSyncReadingList.firstSync();
  log("Read Next: Finished first sync!");

  let bookmarks = await aeReadingList.getAll();
  let msg = {
    id: "reload-bookmarks-event",
    bookmarks,
  };
  browser.runtime.sendMessage(msg);

  // TO DO: Set up sync interval.
}


async function syncReadingList()
{
  let prefs = await aePrefs.getAllPrefs();
  let oauthClient = new aeOAuthClient(prefs.accessToken, prefs.refreshToken);
  let syncBacknd = Number(prefs.syncBackend);
  
  aeSyncReadingList.init(syncBacknd, oauthClient);

  log("Read Next: Starting reading list sync...");
  let localDataChanged = await aeSyncReadingList.sync();
  log("Read Next: Finished sync!");

  if (localDataChanged) {
    let bookmarks = await aeReadingList.getAll();
    let msg = {
      id: "reload-bookmarks-event",
      bookmarks,
    }; 
    browser.runtime.sendMessage(msg);
  }
}


function stopSync()
{
  // TO DO: Stop sync interval.

  aeSyncReadingList.reset();
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
      firstSyncReadingList();
    }
    else {
      warn("Read Next: Sync was turned OFF from extension preferences.");
      stopSync();
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


function info(aMessage)
{
  if (aeConst.DEBUG) { console.info(aMessage) }
}


function warn(aMessage)
{
  if (aeConst.DEBUG) { console.warn(aMessage) }
}
