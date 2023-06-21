/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


let gOS;
let gHostAppName;
let gHostAppVer;
let gPrefs;
let gIsFirstRun = false;
let gVerUpdateType = null;
let gShowUpdateBanner = false;
let gAutoOpenConnectWiz = false;
let gOptionsPgOpen = false;

let gFileHostReauthorizer = {
  _notifcnShown: false,
  _reauthzPg: null,

  get reauthorizePg()
  {
    return this._reauthzPg;
  },

  set reauthorizePg(aWndTabInfo)
  {
    return this._reauthzPg = aWndTabInfo;
  },

  async showPrompts()
  {
    let {fileHostName} = aeFileHostUI(gPrefs.syncBackend);
    let msg = {
      id: "reauthorize-prompt",
      fileHostName,
    };
    
    try {
      await browser.runtime.sendMessage(msg);
    }
    catch {}
    
    if (!this._notifcnShown && !gOptionsPgOpen) {
      browser.notifications.create("reauthorize", {
        type: "basic",
        title: browser.i18n.getMessage("extName"),
        message: browser.i18n.getMessage("reauthzNotifcn", fileHostName),
        iconUrl: "img/icon.svg"
      });
      this._notifcnShown = true;
    }
  },

  async openReauthorizePg()
  {
    // If the reauthorize page is already open, focus its window and tab.
    if (this._reauthzPg) {
      await browser.windows.update(this._reauthzPg.wndID, {focused: true});
      await browser.tabs.update(this._reauthzPg.tabID, {active: true});
      return;
    }

    let backnd = gPrefs.syncBackend;
    let url = browser.runtime.getURL("pages/reauthorize.html?bknd=" + backnd);
    await browser.tabs.create({url});
  },

  reset()
  {
    this._notifcnShown = false;
  }
};


browser.runtime.onInstalled.addListener(async (aInstall) => {
  if (aInstall.reason == "install") {
    log("Read Next: Extension installed.");
  }
  else if (aInstall.reason == "update") {
    let oldVer = aInstall.previousVersion;
    let currVer = browser.runtime.getManifest().version;

    if (currVer == oldVer) {
      log("Read Next: WebExtension reloaded.");
    }
    else {
      log(`Read Next: Updating from version ${oldVer} to ${currVer}`);

      // Version updates can sometimes cause the reading list sidebar to open
      // automatically, even if the user had closed it (WebExtension bug?).
      // When this happens, a message bar should appear, informing the user
      // that Read Next was just updated.
      // By default, any version update is classified as minor.
      // Specific version updates are considered major if it such that a CTA
      // button to the What's New page should appear in the message bar.
      if (aeVersionCmp(oldVer, aeConst.CURR_MAJOR_VER) < 0) {
        gVerUpdateType = aeConst.VER_UPDATE_TYPE_MAJOR;
        setWhatsNewNotificationDelay();
      }
      else {
        gVerUpdateType = aeConst.VER_UPDATE_TYPE_MINOR;
      }
      gShowUpdateBanner = true;
    }
  }
});


// WebExtension initialization
void async function ()
{
  log("Read Next: WebExtension startup initiated.");

  gPrefs = await aePrefs.getAllPrefs();
  log("Read Next: Successfully retrieved user preferences:");
  log(gPrefs);

  if (! aePrefs.hasUserPrefs(gPrefs)) {
    log("Initializing Read Next user preferences.");
    gIsFirstRun = true;
    await aePrefs.setUserPrefs(gPrefs);
  }

  if (! aePrefs.hasPomaikaiPrefs(gPrefs)) {
    log("Initializing 0.8.3 user preferences.");
    await aePrefs.setPomaikaiPrefs(gPrefs);
  }

  if (! aePrefs.hasMauiPrefs(gPrefs)) {
    log("Initializing 1.1 user preferences.");
    await aePrefs.setMauiPrefs(gPrefs);
  }

  if (! aePrefs.hasMaunaKeaPrefs(gPrefs)) {
    log("Initializing additional 1.1 user preferences.");
    await aePrefs.setMaunaKeaPrefs(gPrefs);
  }

  init();
}();


async function init()
{
  let [brws, platform] = await Promise.all([
    browser.runtime.getBrowserInfo(),
    browser.runtime.getPlatformInfo(),
  ]);
  
  gHostAppName = brws.name;
  gHostAppVer = brws.version;
  log(`Read Next: Host app: ${gHostAppName} (version ${gHostAppVer})`);

  gOS = platform.os;
  log("Read Next: OS: " + gOS);

  let prefsStrKey = "mnuPrefs";
  if (gOS == "win") {
    prefsStrKey = "mnuPrefsWin";
  }

  aeReadingList.init();
  
  if (gPrefs.syncEnabled) {
    info("Read Next: Synced reading list is enabled.");
    initSyncInterval();
  }

  // Context menus for browser toolbar button and address bar button
  browser.menus.create({
    id: "ae-readnext-add-and-close-tab",
    title: browser.i18n.getMessage("mnuCloseTabAfterAdd"),
    contexts: ["page_action"],
  });
  browser.menus.create({
    id: "ae-readnext-prefs",
    title: browser.i18n.getMessage(prefsStrKey),
    contexts: ["browser_action", "page_action"],
  });

  setUICustomizations();

  // Disable experimental feature from version 1.1b1
  if (gPrefs.allowEditLinks) {
    aePrefs.setPrefs({allowEditLinks: false});
  }

  // Initialize integration with browser
  let [tab] = await browser.tabs.query({active: true, currentWindow: true});
  let bkmk = await getBookmarkFromTab(tab);
  showPageAction(tab, !!bkmk);
  updateMenus(tab);
}


async function setUICustomizations()
{
  if (gPrefs.showCxtMenu) {
    // TO DO: These WebExtension API calls will throw an exception if the menus
    // were already created. Fix by enclosing in try...catch block, or checking
    // if the menus already exists.
    browser.menus.create({
      id: "ae-readnext-add-bkmk",
      title: browser.i18n.getMessage("addBkmk"),
      contexts: ["page", "tab"],
      visible: false,
    });
    browser.menus.create({
      id: "ae-readnext-submnu",
      title: browser.i18n.getMessage("extName"),
      contexts: ["page", "tab"],
      visible: false,
    });
    browser.menus.create({
      id: "ae-readnext-remove-bkmk",
      parentId: "ae-readnext-submnu",
      title: browser.i18n.getMessage("deleteBkmkCxt"),
      visible: false,
    });
  }
  else {
    try {
      await browser.menus.remove("ae-readnext-add-bkmk");
      await browser.menus.remove("ae-readnext-remove-bkmk");
      await browser.menus.remove("ae-readnext-submnu");
    }
    catch {}
  }
}


async function setWhatsNewNotificationDelay()
{
  // Show post-update notification in 1 minute.
  browser.alarms.create("show-upgrade-notifcn", {
    delayInMinutes: aeConst.POST_UPGRADE_NOTIFCN_DELAY_MS / 60000
  });
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
  // If the reading list sidebar is open, check that there isn't any editing
  // action in progress.
  // TO DO: Make this work for sidebar open in multiple browser windows.
  let isSyncReady = true;
  try {
    let sidebarChk = await browser.runtime.sendMessage({id: "sidebar-sync-ready?"});
    isSyncReady = sidebarChk.isReadyToSync;
  }
  catch {}

  if (! isSyncReady) {
    warn("Read Next: syncReadingList(): The reading list sidebar is not ready for sync; aborting.");
    return;
  }
  
  // Don't assume that the saved access token is the most up to date.
  // This function may be called immediately after the user has reauthorized
  // their file host account and before the changed storage event handler has
  // finished executing, so always load prefs from storage.
  let {syncBackend, accessToken, refreshToken} = await aePrefs.getAllPrefs();
  let oauthClient = new aeOAuthClient(accessToken, refreshToken);
  await aeSyncReadingList.init(Number(syncBackend), oauthClient);

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
    else if (e instanceof TypeError) {
      warn("Read Next: syncReadingList(): Caught TypeError exception.  Unable to connect to the cloud file host.  Details:\n" + e);
      await handleNetworkConnectError();
      throw e;
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

  // Update page action and context menu if the current page is now in the
  // reading list.
  let [tab] = await browser.tabs.query({active: true, currentWindow: true});
  let bkmk = await getBookmarkFromTab(tab);
  let isCurrPgSaved = !!bkmk;

  togglePageActionIcon(isCurrPgSaved, tab);
  updateMenus(tab);
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


async function handleNetworkConnectError()
{
  let {fileHostName} = aeFileHostUI(gPrefs.syncBackend);
  try {
    await browser.runtime.sendMessage({
      id: "sync-failed-netwk-error",
      fileHostName,
    });
  }
  catch {}
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


async function getFileHostUserInfo()
{
  let rv;
  
  // Don't assume that the saved access token is the most up to date.
  // This function may be called immediately after the user has reauthorized
  // their file host account and before the changed storage event handler has
  // finished executing, so always load prefs from storage.
  let {syncEnabled, syncBackend, accessToken, refreshToken} = await aePrefs.getAllPrefs();
  let oauthClient = new aeOAuthClient(accessToken, refreshToken);
  await aeSyncReadingList.init(Number(syncBackend), oauthClient);
 
  if (syncEnabled) {
    try {
      rv = await aeSyncReadingList.getFileHostUsername();
    }
    catch (e) {
      if (e instanceof aeAuthorizationError) {
        warn("Read Next: getFileHostUserInfo(): Caught aeAuthorizationError exception.  Details:\n" + e);
        await handleAuthorizationError();
      }
      else if (e instanceof TypeError) {
        warn("Read Next: getFileHostUserInfo(): Caught TypeError exception.  Unable to connect to the cloud file host.  Details:\n" + e);
      }
      else {
        console.error("Read Next: getFileHostUserInfo(): An unexpected error has occurred.  Details:\n" + e);
      }
      throw e;
    }
  }

  return rv;
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
  if (gPrefs.showPageAction && isSupportedURL(aTab.url)) {
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


function isSupportedURL(aURL)
{
  return (aURL.startsWith("http") || aURL.startsWith("about:reader"));
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
    title.title = browser.i18n.getMessage("deleteBkmk");
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


async function addBookmarkFromPageAction(aCloseTab=false)
{
  let [actvTab] = await browser.tabs.query({active: true, currentWindow: true});
  let url = processURL(actvTab.url);
  let bkmk = await getBookmarkFromTab(actvTab);
  let bkmkExists = !!bkmk;
  let id = getBookmarkIDFromURL(url);
  
  if (bkmkExists) {
    await aeReadingList.remove(id);
  }
  else {
    bkmk = new aeBookmark(id, url, sanitizeHTML(actvTab.title));
    await setBookmarkFavIcon(id, actvTab.favIconUrl);

    if (actvTab.isInReaderMode) {
      bkmk.readerMode = true;
    }

    await addBookmark(bkmk);
  }

  if (aCloseTab) {
    await closeTab(actvTab.id);
  }
  else {
    showPageAction(actvTab, !bkmkExists);
    updateMenus();
  }

  try {
    await pushLocalChanges();
  }
  catch {}
}


async function updateMenus(aTab=null)
{
  if (! aTab) {
    [aTab] = await browser.tabs.query({active: true, currentWindow: true});
  }

  let bkmk = await getBookmarkFromTab(aTab);
  let bkmkExists = !!bkmk;
  
  if (bkmkExists) {
    await browser.menus.update("ae-readnext-add-and-close-tab", {enabled: false});
    if (gPrefs.showCxtMenu) {
      await browser.menus.update("ae-readnext-add-bkmk", {visible: false});
      await browser.menus.update("ae-readnext-submnu", {visible: true});
      await browser.menus.update("ae-readnext-remove-bkmk", {visible: true});
    }
  }
  else {
    await browser.menus.update("ae-readnext-add-and-close-tab", {enabled: true});
    if (gPrefs.showCxtMenu) {
      await browser.menus.update("ae-readnext-add-bkmk", {visible: true});
      await browser.menus.update("ae-readnext-submnu", {visible: false});
      await browser.menus.update("ae-readnext-remove-bkmk", {visible: false});
    }
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


async function closeTab(aTabID)
{
  let tabs = await browser.tabs.query({currentWindow: true});
 
  if (tabs.length == 1) {
    let brwsWnds = await browser.windows.getAll({windowTypes: ["normal"]});
    if (brwsWnds.length == 1) {
      // Open a new blank tab to keep the browser window open.
      await browser.tabs.create({});
    }
  }
  await browser.tabs.remove(aTabID);
}


function showAddBookmarkErrorNotification()
{
  browser.notifications.create("add-error", {
    type: "basic",
    title: browser.i18n.getMessage("extName"),
    message: browser.i18n.getMessage("errAddBkmk"),
    iconUrl: "img/readnext-alert.svg",
  });
}


function showWhatsNewNotification()
{
  browser.notifications.create("whats-new", {
    type: "basic",
    title: browser.i18n.getMessage("extName"),
    message: browser.i18n.getMessage("upgradeNotifcn"),
    iconUrl: "img/readnext128.svg",
  });
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

  case "rename-bookmark":
    aeReadingList.rename(aMessage.bookmarkID, aMessage.newName).then(() => {
      return pushLocalChanges();
    }).then(() => Promise.resolve())
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

  case "get-bookmark":
    return aeReadingList.get(aMessage.bookmarkID);

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

  case "open-link-curr-wnd":
    browser.tabs.update(aMessage.activeTabID, {url: aMessage.url, active: true});
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
      warn("Read Next: Sync turned ON from extension preferences.");
      return firstSyncReadingList();
    }
    else {
      warn("Read Next: Sync turned OFF.");
      return stopSync();
    }
    break;

  case "get-username":
    return getFileHostUserInfo();
    break;
    
  case "reauthorize":
    gFileHostReauthorizer.openReauthorizePg();
    break;

  case "reauthz-pg-status":
    if (aMessage.isOpen) {
      gFileHostReauthorizer.reauthorizePg = {
        tabID: aMessage.tabID,
        wndID: aMessage.wndID,
      };
    }
    else {
      gFileHostReauthorizer.reauthorizePg = null;
    }
    break;

  case "options-pg-status":
    gOptionsPgOpen = aMessage.isOpen;
    break;

  case "close-tab":
    return closeTab(aMessage.tabID);
    break;

  case "enable-auto-open-connect-wiz":
    gAutoOpenConnectWiz = true;
    return Promise.resolve();
    break;

  case "should-open-connect-wiz":
    if (gAutoOpenConnectWiz) {
      gAutoOpenConnectWiz = false;
      return Promise.resolve(true);
    }
    else {
      return Promise.resolve(false);
    }
    break;

  case "get-ver-update-info":
    let showBanner = false;
    if (gVerUpdateType && gShowUpdateBanner) {
      // Only show the sidebar post-update banner once.
      gShowUpdateBanner = false;
      showBanner = true;
    }
    return Promise.resolve({
      verUpdateType: gVerUpdateType,
      showBanner,
    });
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
  else if (aAlarm.name == "show-upgrade-notifcn") {
    showWhatsNewNotification();
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
    let url = processURL(aTab.url);
    if (isRestrictedURL(url)) {
      // Don't show page action button in address bar if URL is restricted,
      // e.g. cloud file host authorization page.
      return;
    }
    
    let bkmk = await getBookmarkFromTab(aTab);
    let bkmkExists = !!bkmk;

    showPageAction(aTab, bkmkExists);
    updateMenus(aTab);
    try {
      await browser.runtime.sendMessage({
        id: "tab-loading-finish-event",
        bkmkExists,
        isSupportedURL: isSupportedURL(aTab.url),
      });
    }
    catch {}

    if (! bkmkExists) {
      return;
    }

    if (gPrefs.deleteReadLinks) {
      // Delete the link regardless of its "read" status.  Need to handle links
      // that were already marked as read before this setting was turned on.
      await aeReadingList.remove(bkmk.id);
      togglePageActionIcon(false);
      updateMenus();
      try {
        await pushLocalChanges();
      }
      catch {}
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

    let bkmk = await getBookmarkFromTab(tab);
    let bkmkExists = !!bkmk;

    try {
      await browser.runtime.sendMessage({
        id: "tab-switching-event",
        bkmkExists,
        isSupportedURL: isSupportedURL(tab.url),
      });
    }
    catch {}
  }
  else {
    warn("Read Next: Tab 'onActivated' event handler is unable to retrieve URL for tab " + aActiveTab.tabId);
  }
});


browser.browserAction.onClicked.addListener(aTab => {
  browser.sidebarAction.toggle();
});


browser.pageAction.onClicked.addListener(() => {
  addBookmarkFromPageAction(gPrefs.closeTabAfterAdd);
});


browser.menus.onClicked.addListener(async (aInfo, aTab) => {
  if (aInfo.menuItemId == "ae-readnext-add-bkmk") {
    // By default, the action applies to the currently active browser tab, but
    // support the selection of more than 1 browser tab from the tab bar.
    let selectedTabs = await browser.tabs.query({
      currentWindow: true,
      highlighted: true,
    });
    
    for (let i = 0; i < selectedTabs.length; i++) {
      let tab = selectedTabs[i];

      if (isSupportedURL(tab.url)) {
        let url = processURL(tab.url);
        let id = getBookmarkIDFromURL(url);
        let bkmk = new aeBookmark(id, url, sanitizeHTML(tab.title));
        await setBookmarkFavIcon(id, tab.favIconUrl);

        if (tab.isInReaderMode) {
          bkmk.readerMode = true;
        }
        
        await addBookmark(bkmk);
        togglePageActionIcon(true, tab);

        if (gPrefs.closeTabAfterAdd) {
          closeTab(tab.id);
        } 
      }
      else {
        if (selectedTabs.length == 1) {
          showAddBookmarkErrorNotification();
        }
        else {
          // Silently skip over the tab showing the Firefox page.
          warn("Read Next: Unsupported page won't be added to reading list: " + tab.url);
        }
      }
    }
  }
  else if (aInfo.menuItemId == "ae-readnext-remove-bkmk") {
    let url = processURL(aTab.url);
    let id = getBookmarkIDFromURL(url);
    await aeReadingList.remove(id);
    togglePageActionIcon(false, aTab);
  }
  else if (aInfo.menuItemId == "ae-readnext-add-and-close-tab") {
    addBookmarkFromPageAction(true);
    return;
  }
  else if (aInfo.menuItemId == "ae-readnext-prefs") {
    browser.runtime.openOptionsPage();
    return;
  }

  updateMenus(aTab);
  try {
    await pushLocalChanges();
  }
  catch {}
});


browser.notifications.onClicked.addListener(aNotifID => {
  if (aNotifID == "reauthorize") {
    gFileHostReauthorizer.openReauthorizePg();
  }
  else if (aNotifID == "whats-new") {
    browser.tabs.create({url: browser.runtime.getURL("pages/whatsnew.html")});    
  }
});


//
// Utilities
//

function sanitizeHTML(aHTMLStr)
{
  return DOMPurify.sanitize(aHTMLStr, { SAFE_FOR_JQUERY: true });
}


function getBookmarkIDFromURL(aURL)
{
  return md5(aURL);
}


function isSupportedURL(aURL)
{
  return (aURL.startsWith("http") || aURL.startsWith("about:reader"));
}


function isRestrictedURL(aURL)
{
  return aURL.startsWith(aeDropbox.AUTHZ_SRV_URL);
}


function processURL(aURL)
{
  let rv;
  
  if (aURL.startsWith("about:reader")) {
    rv = decodeURIComponent(aURL.substring(17));
  }
  else {
    rv = aURL;
  }

  return rv;
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
