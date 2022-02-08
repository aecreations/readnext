/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


let gPrefs;


browser.runtime.onInstalled.addListener(async (aInstall) => {
  if (aInstall.reason == "install") {
    log("Read Next: Extension installed.");

    await setDefaultPrefs();
    init();
  }
});

browser.runtime.onStartup.addListener(async () => {
  log("Read Next: Initializing extension during browser startup.");

  gPrefs = await aePrefs.getAllPrefs();
  init();
});


async function setDefaultPrefs()
{
  let defaultPrefs = aePrefs.getDefaultPrefs();
  await aePrefs.setPrefs(defaultPrefs);

  gPrefs = defaultPrefs;
}


async function init()
{
  aeReadingList.init();
  
  if (gPrefs.syncEnabled) {
    info("Read Next: Synced reading list is enabled.");
    initSyncInterval();
  }
}


async function firstSyncReadingList()
{
  let oauthClient = new aeOAuthClient(gPrefs.accessToken, gPrefs.refreshToken);
  let syncBacknd = Number(gPrefs.syncBackend);
  
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
  let oauthClient = new aeOAuthClient(gPrefs.accessToken, gPrefs.refreshToken);
  let syncBacknd = Number(gPrefs.syncBackend);
  
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
  let periodInMinutes = gPrefs.syncInterval;
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
  if (gPrefs.syncEnabled) {
    log("Read Next: Pushing local changes...");
    await aeSyncReadingList.push();
    await restartSyncInterval();
  }
}


async function addBookmark(aBookmark)
{
  let rv;
  try {
    rv = await aeReadingList.add(aBookmark);
  }
  catch (e) {
    return Promise.reject(e);
  }

  return rv;
}


function showPageAction(aTab)
{
  if (gPrefs.showPageAction && aTab.url.startsWith("http")) {
    browser.pageAction.show(aTab.id);
  }
}


//
// Event handlers
//

browser.runtime.onMessage.addListener(async (aMessage) => {
  log(`Read Next: Background script received extension message "${aMessage.id}"`);

  switch (aMessage.id) {
  case "add-bookmark":
    let bookmarkID = await addBookmark(aMessage.bookmark);
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


browser.storage.onChanged.addListener((aChanges, aAreaName) => {
  let changedPrefs = Object.keys(aChanges);
  
  for (let pref of changedPrefs) {
    gPrefs[pref] = aChanges[pref].newValue;
  }
});


browser.windows.onFocusChanged.addListener(async (aWndID) => {
  let wnd = await browser.windows.getCurrent();
  if (wnd.id == aWndID) {
    if (gPrefs.syncEnabled) {
      log(`Read Next: Handling window focus changed event for window ${wnd.id} - syncing reading list.`);
      syncReadingList();
    }
  }
});


browser.tabs.onUpdated.addListener((aTabID, aChangeInfo, aTab) => {
  if (aChangeInfo.status == "complete") {
    showPageAction(aTab);
  }
}, {properties: ["status"]});


browser.tabs.onActivated.addListener(async (aActiveTab) => {
  let tab = await browser.tabs.get(aActiveTab.tabId);

  // The tab URL may not be available if the tab is loading or asleep.
  if (tab.url) {
    showPageAction(tab);
  }
});


browser.pageAction.onClicked.addListener(async () => {
  let tabs = await browser.tabs.query({active: true, currentWindow: true});
  let title = tabs[0].title;
  let url = tabs[0].url;
  let id = getBookmarkIDFromURL(url);
  let bkmk = new aeBookmark(id, url, title);

  await addBookmark(bkmk);
});


//
// Utilities
//

function getBookmarkIDFromURL(aURL)
{
  return md5(aURL);
}


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
