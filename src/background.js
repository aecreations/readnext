/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


let gPrefs;

let gFileHostReauthorizer = {
  _notifcnShown: false,
  
  async showPrompts()
  {
    try {
      await browser.runtime.sendMessage({id: "reauthorize-prompt"});
    }
    catch {}
    
    if (! this._notifcnShown) {
      browser.notifications.create("reauthorize", {
        type: "basic",
        title: browser.i18n.getMessage("extName"),
        message: "readnext needs to reauthorize your Google Drive account, click here to reauthorize",
        iconUrl: "img/icon.png"
      });
      this._notifcnShown = true;
    }
  },

  async openReauthorizeDlg()
  {
    let backnd = gPrefs.syncBackend;
    let url = browser.runtime.getURL("pages/reauthorize.html?bknd=" + backnd);

    // TO DO: Put this in a pref.
    let autoAdjustWndPos = true;

    // Center the popup window within originating browser window,
    // both horizontally and vertically.
    let wndGeom = null;
    let width = 520;
    let height = 170;

    // Default popup window coords.  Unless replaced by window geometry calcs,
    // these coords will be ignored - popup window will always be centered
    // on screen due to a WebExtension API bug; see next comment.
    let left = 256;
    let top = 64;

    if (autoAdjustWndPos) {
      wndGeom = await this._getWndGeomFromBrwsTab();

      if (wndGeom) {
        if (wndGeom.w < width) {
          left = null;
        }
        else {
          left = Math.ceil((wndGeom.w - width) / 2) + wndGeom.x;
        }

        if ((wndGeom.h) < height) {
          top = null;
        }
        else {
          top = Math.ceil((wndGeom.h - height) / 2) + wndGeom.y;
        }
      }
    }

    let wnd = await browser.windows.create({
      url,
      type: "popup",
      width, height,
      left, top,
    });

    // Workaround to bug where window position isn't correctly set when calling
    // `browser.windows.create()`. If unable to get window geometry, then
    // default to centering on screen.
    if (wndGeom) {
      browser.windows.update(wnd.id, { left, top });
    }
  },

  async _getWndGeomFromBrwsTab()
  {
    let rv = null;
    let wnd = await browser.windows.getCurrent();
    let wndGeom = {
      x: wnd.left,
      y: wnd.top,
    };
    let tabs = await browser.tabs.query({currentWindow: true, discarded: false});
    wndGeom.w = tabs[0].width;
    wndGeom.h = tabs[0].height;
    rv = wndGeom;

    return rv;
  },

  reset()
  {
    this._notificnShown = false;
  }
};


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

  setUICustomizations();
}


async function setUICustomizations()
{
  if (gPrefs.showCxtMenu) {
    // TO DO: These WebExtension API calls will throw an exception if the menus
    // were already created. Fix by enclosing in try...catch block, or checking
    // if the menus already exists.
    browser.menus.create({
      id: "ae-readnext-add-bkmk",
      title: "add to readnext",
      contexts: ["page"],
      visible: false,
    });
    browser.menus.create({
      id: "ae-readnext-submnu",
      title: browser.i18n.getMessage("extName"),
      contexts: ["page"],
      visible: false,
    });
    browser.menus.create({
      id: "ae-readnext-remove-bkmk",
      parentId: "ae-readnext-submnu",
      title: "delete",
      visible: false,
    });
  }
  else {
    try {
      await browser.menus.removeAll();
    }
    catch {}
  }
}


async function firstSyncReadingList()
{
  let oauthClient = new aeOAuthClient(gPrefs.accessToken, gPrefs.refreshToken);
  let syncBacknd = Number(gPrefs.syncBackend);
  
  await aeSyncReadingList.init(syncBacknd, oauthClient);

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
  // Don't assume that the saved access token is the most up to date.
  // This function may be called immediately after the user has reauthorized
  // their file host account, and before the changed storage event handler has
  // executed, so always load prefs from storage.
  let {syncBackend, accessToken, refreshToken} = await aePrefs.getAllPrefs();
  let oauthClient = new aeOAuthClient(accessToken, refreshToken);
  let syncBacknd = Number(syncBackend);
  
  await aeSyncReadingList.init(syncBacknd, oauthClient);

  log("Read Next: Starting reading list sync...");
  let isLocalDataChanged;
  try {
    isLocalDataChanged = await aeSyncReadingList.sync();
  }
  catch (e) {
    if (e instanceof aeAuthorizationError) {
      warn("Read Next: syncReadingList(): Caught aeAuthorizationError exception.  Details:\n" + e);

      gFileHostReauthorizer.showPrompts();
      try {
        await browser.runtime.sendMessage({id: "sync-failed-authz-error"});
      }
      catch {}

      let syncAlarm = await browser.alarms.get("sync-reading-list");
      if (syncAlarm) {
        log("Read Next: syncReadingList(): Suspending auto sync interval.");
        await browser.alarms.clear("sync-reading-list");
      }
    }
    else {
      console.error("Read Next: syncReadingList(): Error: " + e);
    }
    throw e;
  }
  
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


async function showPageAction(aTab, aBookmarkExists=null)
{
  if (gPrefs.showPageAction && aTab.url.startsWith("http")) {
    browser.pageAction.show(aTab.id);

    if (aBookmarkExists === null) {
      let bkmk = await aeReadingList.getByURL(aTab.url);
      aBookmarkExists = !!bkmk;
    }

    togglePageActionIcon(aBookmarkExists, aTab);
  }
  else {
    browser.pageAction.hide(aTab.id);
  }
}


async function togglePageActionIcon(aIsBookmarked, aTab=null)
{
  if (! aTab) {
    let tabs = await browser.tabs.query({active: true, currentWindow: true});
    aTab = tabs[0];
  }
  
  let title = {
    tabId: aTab.id,
    title: null,
  };
  let icon = {tabId: aTab.id};

  if (aIsBookmarked) {
    icon.path = {
      16: "img/bookmarked.svg",
      32: "img/bookmarked.svg",
    };
    title.title = "remove from readnext";    
  }
  else {
    icon.path = {
      16: "img/bookmark.svg",
      32: "img/bookmark.svg",
    };
  }
  browser.pageAction.setIcon(icon);
  browser.pageAction.setTitle(title);
}


async function updateMenus(aTab=null)
{
  if (! aTab) {
    let tabs = await browser.tabs.query({active: true, currentWindow: true});
    aTab = tabs[0];
  }

  let bkmk = await getBookmarkFromTab(aTab);
  let bkmkExists = !!bkmk;
  
  if (bkmkExists) {
    await browser.menus.update("ae-readnext-add-bkmk", {visible: false});
    await browser.menus.update("ae-readnext-submnu", {visible: true});
    await browser.menus.update("ae-readnext-remove-bkmk", {visible: true});
  }
  else {
    await browser.menus.update("ae-readnext-add-bkmk", {visible: true});
    await browser.menus.update("ae-readnext-submnu", {visible: false});
    await browser.menus.update("ae-readnext-remove-bkmk", {visible: false});      
  }
}


async function getBookmarkFromTab(aTab)
{
  let rv;
  let url = aTab.url;
  let id = getBookmarkIDFromURL(url);

  rv = await aeReadingList.get(id);
  return rv;
}


//
// Event handlers
//

browser.runtime.onMessage.addListener(async (aMessage) => {
  log(`Read Next: Background script received extension message "${aMessage.id}"`);

  switch (aMessage.id) {
  case "add-bookmark":
    let bookmarkID = await addBookmark(aMessage.bookmark);
    togglePageActionIcon(true);
    updateMenus();
    await pushLocalChanges();
    return Promise.resolve(bookmarkID);

  case "remove-bookmark":
    await aeReadingList.remove(aMessage.bookmarkID);
    togglePageActionIcon(false);
    updateMenus();
    pushLocalChanges();
    break;

  case "get-all-bookmarks":
    let allBkmks = await aeReadingList.getAll();
    return Promise.resolve(allBkmks);

  case "search-bookmarks":
    let foundBkmks = await aeReadingList.findByTitle(aMessage.searchTerms);
    return Promise.resolve(foundBkmks);

  case "sync-reading-list":
    try {
      await syncReadingList();
    }
    catch {
      break;
    }
    await restartSyncInterval();
    if (aMessage.isReauthorized) {
      gFileHostReauthorizer.reset();
    }
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
    
  case "reauthorize":
    gFileHostReauthorizer.openReauthorizeDlg();
    break;
    
  default:
    break;
  }
});


browser.alarms.onAlarm.addListener(async (aAlarm) => {
  if (aAlarm.name == "sync-reading-list") {
    try {
      await syncReadingList();
    }
    catch {}
  }
});


browser.storage.onChanged.addListener((aChanges, aAreaName) => {
  let changedPrefs = Object.keys(aChanges);
  
  for (let pref of changedPrefs) {
    gPrefs[pref] = aChanges[pref].newValue;
  }

  setUICustomizations();
});


browser.windows.onFocusChanged.addListener(async (aWndID) => {
  let wnd = await browser.windows.getCurrent();
  if (wnd.id == aWndID) {
    if (gPrefs.syncEnabled) {
      // Don't trigger sync if syncing is suspended.
      let syncAlarm = await browser.alarms.get("sync-reading-list");
      if (! syncAlarm) {
        return;
      }

      log(`Read Next: Handling window focus changed event for window ${wnd.id} - syncing reading list.`);
      try {
        await syncReadingList();
      }
      catch {}
    }
  }
});


browser.tabs.onUpdated.addListener(async (aTabID, aChangeInfo, aTab) => {
  if (aChangeInfo.status == "complete") {
    let bkmk = await getBookmarkFromTab(aTab);
    let bkmkExists = !!bkmk;

    showPageAction(aTab, bkmkExists);
    updateMenus(aTab);

    if (bkmkExists && bkmk.unread) {
      await aeReadingList.markAsRead(bkmk.id);
      pushLocalChanges();
    }
  }
}, {properties: ["status"]});


browser.tabs.onActivated.addListener(async (aActiveTab) => {
  let tab = await browser.tabs.get(aActiveTab.tabId);

  // The tab URL may not be available if the tab is loading or asleep.
  if (tab.url) {
    showPageAction(tab);
    updateMenus(tab);
  }
});


browser.browserAction.onClicked.addListener(aTab => {
  browser.sidebarAction.toggle();
});


browser.pageAction.onClicked.addListener(async () => {
  let tabs = await browser.tabs.query({active: true, currentWindow: true});
  let bkmk = await getBookmarkFromTab(tabs[0]);
  let bkmkExists = !!bkmk;
  let id = getBookmarkIDFromURL(tabs[0].url);
  
  if (bkmkExists) {
    await aeReadingList.remove(id);
  }
  else {
    bkmk = new aeBookmark(id, tabs[0].url, tabs[0].title);
    await addBookmark(bkmk);
  }

  showPageAction(tabs[0], !bkmkExists);
});


browser.menus.onClicked.addListener(async (aInfo, aTab) => {
  let id = getBookmarkIDFromURL(aTab.url);

  switch (aInfo.menuItemId) {
  case "ae-readnext-add-bkmk":
    bkmk = new aeBookmark(id, aTab.url, aTab.title);
    await addBookmark(bkmk);
    break;

  case "ae-readnext-remove-bkmk":
    await aeReadingList.remove(id);
    break;

  default:
    break;
  }

  updateMenus(aTab);
});


browser.notifications.onClicked.addListener(aNotificationID => {
  if (aNotificationID == "reauthorize") {
    gFileHostReauthorizer.openReauthorizeDlg();
  }
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
