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
    initSyncInterval();
  }
}


async function firstSyncReadingList()
{
  let prefs = await aePrefs.getAllPrefs();
  let oauthClient = new aeOAuthClient(prefs.accessToken, prefs.refreshToken);
  let syncBacknd = Number(prefs.syncBackend);
  
  aeSyncReadingList.init(syncBacknd, oauthClient);

  log("Read Next: Starting first reading list sync...");
  await aeSyncReadingList.firstSync();
  log("Read Next: Finished first sync!");

  let bookmarks = await aeReadingList.getAll();
  let msg = {
    id: "reload-bookmarks-event",
    bookmarks,
  };
  try {
    await browser.runtime.sendMessage(msg);
  }
  catch {}

  initSyncInterval();
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

  let bookmarks = await aeReadingList.getAll();
  let msg = {
    id: "reload-bookmarks-event",
    bookmarks,
  }; 
  try {
    await browser.runtime.sendMessage(msg);
  }
  catch {}
}


async function initSyncInterval()
{
  let periodInMinutes = await aePrefs.getPref("syncInterval");
  browser.alarms.create("sync-reading-list", {periodInMinutes});
  info(`Read Next: Reading list will be synced every ${periodInMinutes} mins.`);
}


async function stopSync()
{
  await browser.alarms.clear("sync-reading-list");
  aeSyncReadingList.reset();
  log("Read Next: Sync stopped.");
}


async function restartSyncInterval()
{
  log("Read Next: Restarting sync interval...");
  await browser.alarms.clear("sync-reading-list");
  await initSyncInterval();
}


async function pushLocalChanges()
{
  let syncEnabled = await aePrefs.getPref("syncEnabled");
  if (syncEnabled) {
    log("Read Next: Pushing local changes...");
    await aeSyncReadingList.push();
    await restartSyncInterval();
  }
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
    await pushLocalChanges();
    return Promise.resolve(bookmarkID);

  case "remove-bookmark":
    aeReadingList.remove(aMessage.bookmarkID);
    pushLocalChanges();
    break;

  case "get-all-bookmarks":
    let allBkmks = await aeReadingList.getAll();
    return Promise.resolve(allBkmks);

  case "search-bookmarks":
    let foundBkmks = await aeReadingList.findByTitle(aMessage.searchTerms);
    return Promise.resolve(foundBkmks);

  case "sync-reading-list":
    await syncReadingList();
    await restartSyncInterval();
    break;

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


browser.alarms.onAlarm.addListener(aAlarm => {
  if (aAlarm.name == "sync-reading-list") {
    syncReadingList();
  }
});


browser.windows.onFocusChanged.addListener(async (aWndID) => {
  let wnd = await browser.windows.getCurrent();
  if (wnd.id == aWndID) {
    let syncEnabled = await aePrefs.getPref("syncEnabled");
    if (syncEnabled) {
      log(`Read Next: Handling window focus changed event for window ${wnd.id} - syncing reading list.`);
      syncReadingList();
    }
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
