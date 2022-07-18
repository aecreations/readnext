/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


let gPrefs;

let gFileHostReauthorizer = {
  _notifcnShown: false,
  
  async showPrompts()
  {
    let fileHostName = getFileHostUIString();
    let msg = {
      id: "reauthorize-prompt",
      fileHostName,
    };
    
    try {
      await browser.runtime.sendMessage(msg);
    }
    catch {}
    
    if (! this._notifcnShown) {
      browser.notifications.create("reauthorize", {
        type: "basic",
        title: browser.i18n.getMessage("extName"),
        message: `readnext needs to reauthorize your ${fileHostName} account, click here to reauthorize`,
        iconUrl: "img/icon.png"
      });
      this._notifcnShown = true;
    }
  },

  async openReauthorizeDlg()
  {
    let backnd = gPrefs.syncBackend;
    let url = browser.runtime.getURL("pages/reauthorize.html?bknd=" + backnd);
    await browser.tabs.create({url});
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


// WebExtension initialization
void function () {
  log("Read Next: Initializing WebExtension from IIFE.");

  aePrefs.getAllPrefs().then(aPrefs => {
    gPrefs = aPrefs;
    init();
  });
}();


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
      await handleAuthorizationError();
      throw e;
    }
    else if (e instanceof aeNotFoundError) {
      warn("Read Next: syncReadingList(): Caught aeNotFoundError exception.  Details:\n" + e);
      log("Regenerating sync file...");
      await aeSyncReadingList.push(true);
    }
    else {
      console.error("Read Next: syncReadingList(): An unexpected error has occurred.  Details:\n" + e);
      throw e;
    }
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


async function handleAuthorizationError()
{
  gFileHostReauthorizer.showPrompts();
  try {
    await browser.runtime.sendMessage({id: "sync-failed-authz-error"});
  }
  catch {}

  let syncAlarm = await browser.alarms.get("sync-reading-list");
  if (syncAlarm) {
    log("Read Next: handleAuthorizationError(): Suspending auto sync interval.");
    await browser.alarms.clear("sync-reading-list");
  }
}


function initSyncInterval()
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
  initSyncInterval();
}


async function pushLocalChanges()
{
  if (gPrefs.syncEnabled) {
    log("Read Next: Pushing local changes...");
    try {
      await aeSyncReadingList.push();
    }
    catch (e) {
      if (e instanceof aeAuthorizationError) {
        warn("Read Next: pushLocalChanges(): Caught aeAuthorizationError exception.  Details:\n" + e);
        await handleAuthorizationError();
      }
      else {
        console.error("Read Next: pushLocalChanges(): An unexpected error has occurred.  Details:\n" + e);
      }
      throw e;
    }
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


async function setBookmarkFavIcon(aBookmarkID, aFavIconDataURL)
{
  if (!aFavIconDataURL || !aFavIconDataURL.startsWith("data:")) {
    log("Read Next: setBookmarkFavIcon(): No favicon data found for bookmark " + aBookmarkID);
    return;
  }

  await aeReadingList.setFavIcon(aBookmarkID, aFavIconDataURL);
}


async function updateBookmarkFavIcon(aBookmarkID, aTabID)
{
  let tab = await browser.tabs.get(aTabID);

  if (tab.favIconUrl) {
    setBookmarkFavIcon(aBookmarkID, tab.favIconUrl);
  }
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
    [aTab] = await browser.tabs.query({active: true, currentWindow: true});
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


function getFileHostUIString()
{
  let rv;
  let backnd = Number(gPrefs.syncBackend);

  switch (backnd) {
  case aeConst.FILEHOST_DROPBOX:
    rv = "dropbox";
    break;

  case aeConst.FILEHOST_GOOGLE_DRIVE:
    rv = "googledrive";
    break;

  case aeConst.FILEHOST_ONEDRIVE:
    rv = "onedrive";
    break;

  default:
    break;
  }

  return rv;
}


//
// Event handlers
//

browser.runtime.onMessage.addListener(aMessage => {
  log(`Read Next: Background script received extension message "${aMessage.id}"`);

  switch (aMessage.id) {
  case "add-bookmark":
    let newBkmkID;
    addBookmark(aMessage.bookmark).then(aBkmkID => {
      newBkmkID = aBkmkID;
      togglePageActionIcon(true);
      updateMenus();
      return pushLocalChanges();
    }).then(() => Promise.resolve(newBkmkID))
      .catch(aErr => Promise.reject(aErr));
    break;

  case "remove-bookmark":
    aeReadingList.remove(aMessage.bookmarkID).then(() => {
      togglePageActionIcon(false);
      updateMenus();
      return pushLocalChanges();
    }).then(() => Promise.resolve())
      .catch(aErr => Promise.reject(aErr));
    break;

  case "get-all-bookmarks":
    return aeReadingList.getAll();

  case "search-bookmarks":
    return aeReadingList.findByTitle(aMessage.searchTerms);

  case "add-favicon":
    setBookmarkFavIcon(aMessage.bookmarkID, aMessage.favIconURL);
    break;

  case "get-favicon-map":
    return aeReadingList.getFavIconMap();

  case "mark-as-read":
    aeReadingList.markAsRead(aMessage.bookmarkID, aMessage.isRead)
      .then(() => pushLocalChanges())
      .then(() => Promise.resolve())
      .catch(aErr => Promise.reject(aErr));
    break;

  case "sync-reading-list":
    syncReadingList().then(() => {
      return restartSyncInterval();
    }).catch(aErr => {
      // Exceptions already handled, no further action needed.
      return Promise.resolve();
    }).then(() => {
      if (aMessage.isReauthorized) {
        gFileHostReauthorizer.reset();
      }
      return Promise.resolve();
    });
    break;

  case "sync-setting-changed":
    if (aMessage.syncEnabled) {
      warn("Read Next: Sync was turned ON from extension preferences.");
      return firstSyncReadingList();
    }
    else {
      warn("Read Next: Sync was turned OFF from extension preferences.");
      return stopSync();
    }
    break;

  case "get-username":
    return aeSyncReadingList.getFileHostUsername();
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

    if (! bkmkExists) {
      return;
    }

    if (bkmk.unread) {
      await aeReadingList.markAsRead(bkmk.id, true);
      try {
        await pushLocalChanges();
      }
      catch {}
    }

    // Update favicon in case the website favicon changed since last visit.
    if (aTab.favIconUrl) {
      setBookmarkFavIcon(bkmk.id, aTab.favIconUrl);
    }
    else {
      // Loading the favicon is sometimes delayed.
      window.setTimeout(() => {
        updateBookmarkFavIcon(bkmk.id, aTabID);
      }, aeConst.FAVICON_LOAD_RETRY_DELAY_MS);
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
  let [actvTab] = await browser.tabs.query({active: true, currentWindow: true});
  let bkmk = await getBookmarkFromTab(actvTab);
  let bkmkExists = !!bkmk;
  let id = getBookmarkIDFromURL(actvTab.url);
  
  if (bkmkExists) {
    await aeReadingList.remove(id);
  }
  else {
    bkmk = new aeBookmark(id, actvTab.url, actvTab.title);
    await setBookmarkFavIcon(id, actvTab.favIconUrl);
    await addBookmark(bkmk);
  }

  showPageAction(actvTab, !bkmkExists);
  updateMenus();
  try {
    await pushLocalChanges();
  }
  catch {}
});


browser.menus.onClicked.addListener(async (aInfo, aTab) => {
  let id = getBookmarkIDFromURL(aTab.url);

  switch (aInfo.menuItemId) {
  case "ae-readnext-add-bkmk":
    bkmk = new aeBookmark(id, aTab.url, aTab.title);
    await setBookmarkFavIcon(id, aTab.favIconUrl);
    await addBookmark(bkmk);
    togglePageActionIcon(true, aTab);
    break;

  case "ae-readnext-remove-bkmk":
    await aeReadingList.remove(id);
    togglePageActionIcon(false, aTab);
    break;

  default:
    break;
  }

  updateMenus(aTab);
  try {
    await pushLocalChanges();
  }
  catch {}
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
