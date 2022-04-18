/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let gPrefs;

// Sidebar actions
let gCmd = {
  async open(aBookmarkID, aURL)
  {
    let tabs = await browser.tabs.query({active: true, currentWindow: true});
    await browser.tabs.update(tabs[0].id, {
      active: true,
      url: aURL,
    });
  
    this._afterBookmarkOpened(aBookmarkID);
  },

  openInNewTab(aBookmarkID, aURL)
  {
    browser.tabs.create({url: aURL});
    this._afterBookmarkOpened(aBookmarkID);
  },

  openInNewWnd(aBookmarkID, aURL)
  {
    browser.windows.create({url: aURL});
    this._afterBookmarkOpened(aBookmarkID);
  },

  async openInNewPrivateWnd(aBookmarkID, aURL)
  {
    try {
      await browser.windows.create({url: aURL, incognito: true});
    }
    catch (e) {
      console.error("Read Next: Error from sidebar context menu: " + e);
    }
    this._afterBookmarkOpened(aBookmarkID);
  },

  async addBookmark(aBookmark)
  {
    if (! aBookmark.id) {
      throw new Error("Bookmark ID is invalid or undefined");
    }

    let msg = {
      id: "add-bookmark",
      bookmark: aBookmark,
    };

    let bkmkID;
    try {
      bkmkID = await browser.runtime.sendMessage(msg);
    }
    catch (e) {
      log(`gCmd.addBookmark(): Error response to WebExtension message "add-bookmark" was received. Details:\n` + e);
      throw e;
    }
  },

  async deleteBookmark(aBookmarkID)
  {
    let msg = {
      id: "remove-bookmark",
      bookmarkID: aBookmarkID,
    };
    
    try {
      await browser.runtime.sendMessage(msg);
    }
    catch (e) {
      log(`gCmd.deleteBookmark(): Error response to WebExtension message "remove-bookmark" was received. Details:\n` + e);
      throw e;
    }
  },

  async getBookmarks()
  {
    let rv;
    let msg = {
      id: "get-all-bookmarks"
    };

    rv = await browser.runtime.sendMessage(msg);
    return rv;
  },

  async syncBookmarks()
  {
    let msg = {
      id: "sync-reading-list",
      isReauthorized: false,
    };
    await browser.runtime.sendMessage(msg);
  },

  async markAsRead(aBookmarkID, aIsRead)
  {
    let msg = {
      id: "mark-as-read",
      bookmarkID: aBookmarkID,
      isRead: aIsRead,
    };
    await browser.runtime.sendMessage(msg);
  },


  // Helper
  async _afterBookmarkOpened(aBookmarkID)
  {
    if (gPrefs.deleteReadLinks) {
      // TEMPORARY
      // TO DO: Delete the bookmark after the page has finished loading.
      setTimeout(() => { this.deleteBookmark(aBookmarkID) }, 3000);
      // END TEMPORARY
    }
  },
};


let gFavIconMap = {
  _favIconMap: null,

  async init()
  {    
    if (! this._favIconMap) {
      this._favIconMap = await browser.runtime.sendMessage({id: "get-favicon-map"});
    }
  },

  set(aBookmarkID, aFavIconURL)
  {
    if (! (this._favIconMap instanceof Map)) {
      throw new Error("gFavIconMap not initialized");
    }

    this._favIconMap.set(aBookmarkID, aFavIconURL);
  },

  add(aBookmarkID, aFavIconURL)
  {
    this.set(aBookmarkID, aFavIconURL);
    
    let msg = {
      id: "add-favicon",
      bookmarkID: aBookmarkID,
      favIconURL: aFavIconURL,
    };

    browser.runtime.sendMessage(msg);
  },

  get(aBookmarkID)
  {
    if (! (this._favIconMap instanceof Map)) {
      throw new Error("gFavIconMap not initialized");
    }

    return this._favIconMap.get(aBookmarkID);
  },

  has(aBookmarkID)
  {
    if (! (this._favIconMap instanceof Map)) {
      throw new Error("gFavIconMap not initialized");
    }

    return this._favIconMap.has(aBookmarkID);
  },

  clear()
  {
    this._favIconMap = null;
  }
};


// Search box
let gSearchBox = {
  _isInitialized: false,
  _isActive: false,
  _numMatches: null,

  init()
  {
    if (this._isInitialized) {
      return;
    }
    
    // TO DO: Localize search box.
    /***
    $("#search-box").prop("placeholder", browser.i18n.getMessage("srchBoxHint"));
    ***/

    this._isInitialized = true;
  },

  isActivated()
  {
    return this._isActive;
  },

  async updateSearch()
  {
    let msg = {
      id: "search-bookmarks",
      searchTerms: $("#search-box").val(),
    };
    let srchResults = await browser.runtime.sendMessage(msg);

    this._numMatches = srchResults.length;
    await rebuildReadingList(srchResults);
  },

  getCountMatches()
  {
    return this._numMatches;
  },

  activate()
  {
    this._isActive = true;
  },

  async reset()
  {
    $("#search-box").val("").focus();
    this._isActive = false;
    this._numMatches = null;

    let bkmks = await gCmd.getBookmarks();
    rebuildReadingList(bkmks);
  }
};


// Sidebar initialization
$(async () => {
  gPrefs = await aePrefs.getAllPrefs();
  
  // TO DO: Is this still needed? Should this be done in the background script?
  if (gPrefs.syncEnabledFromExtPrefs) {
    await aePrefs.setPrefs({syncEnabledFromExtPrefs: false});
  }
  // END TO DO

  try {
    await initReadingList();
  }
  catch (e) {
    let errMsg = $("<p>").addClass("error").text(e);
    $("#sidebar-content").append(errMsg);
    return;
  }

  initContextMenu.showManualSync = gPrefs.syncEnabled;
  initContextMenu.showOpenInPrivBrws = await browser.extension.isAllowedIncognitoAccess();
  initContextMenu();
});


async function initReadingList(aLocalDataOnly=false)
{
  log("Read Next::sidebar.js: initReadingList(): Initializing sidebar" + (aLocalDataOnly ? " (local data only).":"."));

  await gFavIconMap.init();

  if (gPrefs.syncEnabled && !aLocalDataOnly) {
    log("Read Next::sidebar.js: initReadingList(): Sync enabled.  Syncing reading list.");
    await gCmd.syncBookmarks();
  }
  else {
    let bkmks = await gCmd.getBookmarks();
    if (! bkmks) {
      throw new Error("Failed to load reading list");
    }

    if (bkmks.length == 0) {
      showWelcome();
    }
    else {
      hideWelcome();
      buildReadingList(bkmks);
    }
  }
}


function buildReadingList(aBookmarks)
{
  log(`Read Next: ${aBookmarks.length} items.`);
  log(aBookmarks);

  for (let bkmk of aBookmarks) {
    addReadingListItem(bkmk);
  }
}


function addReadingListItem(aBookmark)
{
  hideWelcome();
  
  let tooltipText = `${aBookmark.title}\n${aBookmark.url}`;
  let listItemDiv = $("<div>").addClass("reading-list-item").attr("title", tooltipText)[0];
  listItemDiv.dataset.id = aBookmark.id;
  listItemDiv.dataset.title = aBookmark.title;
  listItemDiv.dataset.url = aBookmark.url;
  listItemDiv.dataset.unread = aBookmark.unread;

  if (aBookmark.unread) {
    let cls = gPrefs.boldUnreadBkmks ? "unread" : "unread-no-fmt"
    listItemDiv.classList.add(cls);
  }

  let favIconCanvas = $("<canvas>").addClass("favicon").attr("width", "16").attr("height", "16")[0];
  let canvasCtx = favIconCanvas.getContext("2d");
  let img = new Image();
  img.onload = function () {
    canvasCtx.clearRect(0, 0, 16, 16);
    canvasCtx.drawImage(this, 0, 0, 16, 16);
  };
  
  if (gFavIconMap.has(aBookmark.id)) {
    let favIconDataURL = gFavIconMap.get(aBookmark.id);
    img.src = favIconDataURL;
  }
  else {
    img.src = aeConst.DEFAULT_FAVICON;
  }

  let listItemTitle = $("<span>").addClass("reading-list-item-title").text(aBookmark.title);
  let listItem = $(listItemDiv);
  listItem.append(favIconCanvas);
  listItem.append(listItemTitle);
  $("#reading-list").append(listItem);
}


function removeReadingListItem(aBookmarkID)
{
  let bkmkElt = $(`.reading-list-item[data-id="${aBookmarkID}"]`);
  bkmkElt.fadeOut(800);
}


async function rebuildReadingList(aBookmarks, aReloadFavIcons=false)
{
  hideWelcome();
  $("#reading-list").empty();

  if (aReloadFavIcons) {
    gFavIconMap.clear();
    await gFavIconMap.init();
  }
  
  buildReadingList(aBookmarks);
}


function isReadingListEmpty()
{
  return ($("#reading-list").children().length == 0);
}


function readingListItemExists(aBookmarkID)
{
  let rv;
  let listItem = $(`#reading-list > .reading-list-item[data-id="${aBookmarkID}"]`);
  rv = listItem.length > 0;

  return rv;
}


function markAsRead(aBookmarkID, aIsRead)
{
  let listItem = $(`#reading-list > .reading-list-item[data-id="${aBookmarkID}"]`);
  let cls = gPrefs.boldUnreadBkmks ? "unread" : "unread-no-fmt"

  if (aIsRead) {
    listItem.removeClass(cls);
    listItem.attr("data-unread", false);
  }
  else {
    listItem.addClass(cls);
    listItem.attr("data-unread", true);
  }
}


function updateFavIcon(aBookmarkID, aFavIconData)
{
  let favIconCanvas = $(`#reading-list > .reading-list-item[data-id="${aBookmarkID}"] > .favicon`)[0];
  let canvasCtx = favIconCanvas.getContext("2d");
  let img = new Image();
  img.onload = function () {
    canvasCtx.clearRect(0, 0, 16, 16);
    canvasCtx.drawImage(this, 0, 0, 16, 16);
  };
  
  img.src = aFavIconData ? aFavIconData : aeConst.DEFAULT_FAVICON;
}


function initContextMenu()
{
  $.contextMenu({
    selector: ".reading-list-item",
    items: {
      openInNewTab: {
        name: "open in new tab",
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          gCmd.openInNewTab(bkmkElt.dataset.id, bkmkElt.dataset.url);
        }
      },
      openInNewWnd: {
        name: "open in new window",
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          gCmd.openInNewWnd(bkmkElt.dataset.id, bkmkElt.dataset.url);
        }
      },
      openInNewPrivateWnd: {
        name: "open in new private window",
        className: "ae-menuitem",
        async callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          let url = bkmkElt.dataset.url;
          gCmd.openInNewPrivateWnd(bkmkElt.dataset.id, bkmkElt.dataset.url);
        },
        visible(aKey, aOpt) {
          return initContextMenu.showOpenInPrivBrws;
        }
      },
      bkmkActionsSep: "---",
      markAsRead: {
        name: "mark as read",
        className: "ae-menuitem",
        async callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          let bkmkID = bkmkElt.dataset.id;
          await gCmd.markAsRead(bkmkID, true);
        },
        visible(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          return bkmkElt.dataset.unread === "true";
        }
      },
      markAsUnread: {
        name: "mark as unread",
        className: "ae-menuitem",
        async callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          let bkmkID = bkmkElt.dataset.id;
          await gCmd.markAsRead(bkmkID, false);
        },
        visible(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          return bkmkElt.dataset.unread === "false";
        }
      },
      deleteBookmark: {
        name: "delete",
        className: "ae-menuitem",
        async callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          let bkmkID = bkmkElt.dataset.id;
          log(`Read Next::sidebar.js: Removing bookmark ID: ${bkmkID}`);
          try {
            await gCmd.deleteBookmark(bkmkID);
          }
          catch (e) {
            warn("Read Next: Error removing bookmark: " + e);
          }
        }
      },
      syncSep: {
        type: "cm_separator",
        visible(aKey, aOpt) {
          return initContextMenu.showManualSync;
        }
      },
      syncBkmksNow: {
        name: "sync now",
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          gCmd.syncBookmarks();
        },
        visible(aKey, aOpt) {
          return initContextMenu.showManualSync;
        }
      }
    }
  });
}
initContextMenu.showManualSync = false;
initContextMenu.showOpenInPrivBrws = false;


function showWelcome()
{
  $("#welcome").show();
}


function hideWelcome()
{
  $("#welcome").hide();
}


function showToolbar()
{
  $("#toolbar").show();
}


function hideToolbar()
{
  $("#toolbar").hide();
}


function enableAddLinkBtn()
{
  $("#add-link").removeAttr("disabled");
}


function disableAddLinkBtn()
{
  $("#add-link").attr("disabled", "true");
}


function showMessageBar(aMsgBarStor)
{
  $(`#msgbars, #msgbars > ${aMsgBarStor}`).show();
}


function hideMessageBar()
{
  $("#msgbars, #msgbars > .msgbar").hide();
}


//
// Event handlers
//

browser.runtime.onMessage.addListener(aMessage => {
  if (aeConst.DEBUG) {
    browser.windows.getCurrent().then(aWnd => {
      log(`Read Next::sidebar.js: [Window ID: ${aWnd.id}] Received extension message "${aMessage.id}"`);
      handleExtMessage(aMessage);
    });
  }
  else {
    handleExtMessage(aMessage);
  }
});


function handleExtMessage(aMessage)
{
  switch (aMessage.id) {
  case "add-bookmark-event":
    addReadingListItem(aMessage.bookmark);
    break;

  case "remove-bookmark-event":
    removeReadingListItem(aMessage.bookmarkID);
    break;

  case "reload-bookmarks-event":
    if ($("#reauthz-msgbar").is(":visible")) {
      hideMessageBar();
    }
    rebuildReadingList(aMessage.bookmarks);    
    break;

  case "set-favicon-event":
    gFavIconMap.set(aMessage.bookmarkID, aMessage.iconData);
    // The favicon map is populated before a new bookmark is added, so check
    // that the bookmark exists.
    if (readingListItemExists(aMessage.bookmarkID)) {
      updateFavIcon(aMessage.bookmarkID, aMessage.iconData);
    }
    break;

  case "mark-read-event":
    markAsRead(aMessage.bookmarkID, aMessage.isRead);
    break;

  case "sync-setting-changed":
    initContextMenu.showManualSync = aMessage.syncEnabled;
    // The message listener in the background script for the same message
    // returns a promise, so do the same here.
    return Promise.resolve();

  case "sync-failed-authz-error":
    if (isReadingListEmpty()) {
      initReadingList(true);
    }
    break;

  case "reauthorize-prompt":
    $("#reauthz-msgbar-content").text(`readnext needs to reauthorize your ${aMessage.fileHostName} account`);
    showMessageBar("#reauthz-msgbar");
    break;

  default:
    break;
  }
}


browser.storage.onChanged.addListener((aChanges, aAreaName) => {
  let changedPrefs = Object.keys(aChanges);
  
  for (let pref of changedPrefs) {
    gPrefs[pref] = aChanges[pref].newValue;
  }

  if (changedPrefs.includes("boldUnreadBkmks")) {
    let isSet = Boolean(aChanges["boldUnreadBkmks"].newValue);
    let oldCls = isSet ? "unread-no-fmt" : "unread";
    let newCls = isSet ? "unread" : "unread-no-fmt";
    let unreadBkmks = $(`.reading-list-item[data-unread="true"]`).get();
    
    for (let bkmk of unreadBkmks) {
      bkmk.classList.replace(oldCls, newCls);
    }
  }
});


$("#add-link").on("click", async (aEvent) => {
  let [actvTab] = await browser.tabs.query({active: true, currentWindow: true});
  let title = actvTab.title;
  let url = actvTab.url;
  let id = getBookmarkIDFromURL(url);
  let bkmk = new aeBookmark(id, url, title);

  let iconURL = actvTab.favIconUrl;
  if (iconURL) {
    gFavIconMap.add(id, iconURL);
  }

  try {
    await gCmd.addBookmark(bkmk);
  }
  catch (e) {
    warn("Read Next: Error adding bookmark: " + e);
    return;
  }
 
  hideWelcome();  
});


$("#setup").on("click", aEvent => {
  browser.runtime.openOptionsPage();
});


$("#reading-list").on("click", async (aEvent) => {
  let readingListItem;
  if (aEvent.target.className == "reading-list-item-title"
      || aEvent.target.className == "favicon") {
    readingListItem = aEvent.target.parentNode;
  }
  else if (aEvent.target.classList.contains("reading-list-item")) {
    readingListItem = aEvent.target;
  }

  gCmd.open(readingListItem.dataset.id, readingListItem.dataset.url);
});


$("#search-box").focus(aEvent => {
  gSearchBox.activate();
});


$("#search-box").on("keyup", aEvent => {
  if (aEvent.key == "Escape" && gSearchBox.isActivated()) {
    gSearchBox.reset();
  }
  else {
    if (! gSearchBox.isActivated()) {
      gSearchBox.activate();
    }
    gSearchBox.updateSearch();
  }
});


$("#reauthorize").on("click", aEvent => {
  browser.runtime.sendMessage({id: "reauthorize"});
});


$(document).on("contextmenu", aEvent => {
  aEvent.preventDefault();
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


function warn(aMessage)
{
  if (aeConst.DEBUG) { console.warn(aMessage) }
}
