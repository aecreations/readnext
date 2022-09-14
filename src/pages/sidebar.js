/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const TOOLBAR_HEIGHT = 28;
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

  async getBookmark(aBkmkID)
  {
    let rv;
    let msg = {
      id: "get-bookmark",
      bookmarkID: aBkmkID,
    };

    rv = await browser.runtime.sendMessage(msg);
    return rv;
  },

  async getBookmarks()
  {
    let rv = await browser.runtime.sendMessage({id: "get-all-bookmarks"});
    return rv;
  },

  async syncBookmarks()
  {
    await browser.runtime.sendMessage({
      id: "sync-reading-list",
      isReauthorized: false,
    });
  },

  async markAsRead(aBookmarkID, aIsRead)
  {
    await browser.runtime.sendMessage({
      id: "mark-as-read",
      bookmarkID: aBookmarkID,
      isRead: aIsRead,
    });
  },

  async closeTab(aTabID)
  {
    await browser.runtime.sendMessage({
      id: "close-tab",
      tabID: aTabID,
    });
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


let gReadingListFilter = {
  ALL: 0,
  UNREAD: 1,
  
  _filter: 0,

  getSelectedFilter()
  {
    return this._filter;
  },

  async setFilter(aFilter)
  {
    if (this._filter == aFilter) {
      return;
    }

    this._filter = aFilter;
    let bkmks = await gCmd.getBookmarks();
    await rebuildReadingList(bkmks, aFilter == this.UNREAD);

    if (bkmks.length == 0) {
      showEmptyMsg();
    }
    else {
      if (aFilter == this.UNREAD && isReadingListEmpty()) {
        showNoUnreadMsg();
      }
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
    
    $("#search-box").prop("placeholder", browser.i18n.getMessage("srchBoxHint"))
      .focus(aEvent => {
        gSearchBox.activate();
        $("#search-box-ctr").addClass("focus");
      })
      .blur(aEvent => {
        gSearchBox.deactivate();
        $("#search-box-ctr").removeClass("focus");
      })
      .keyup(aEvent => {
        this.updateSearch();
        $("#clear-search").css({
          visibility: (aEvent.target.value ? "visible" : "hidden")
        });
      });

    $("#clear-search").click(aEvent => { this.reset() });

    this._isInitialized = true;
  },

  isActivated()
  {
    return this._isActive;
  },

  show()
  {
    $("#search-bar").show();
  },

  hide()
  {
    this.deactivate();
    $("#search-bar").hide();
  },

  async updateSearch()
  {
    let msg = {
      id: "search-bookmarks",
      searchTerms: $("#search-box").val(),
    };
    let srchResults = await browser.runtime.sendMessage(msg);

    this._numMatches = srchResults.length;
    let unreadOnly = gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD;
    await rebuildReadingList(srchResults, unreadOnly);
  },

  getCountMatches()
  {
    return this._numMatches;
  },

  activate()
  {
    this._isActive = true;
  },

  deactivate()
  {
    this._isActive = false;
  },

  async reset()
  {
    $("#search-box").val("").focus();
    $("#clear-search").css({visibility: "hidden"});
    this._isActive = false;
    this._numMatches = null;

    let bkmks = await gCmd.getBookmarks();
    let unreadOnly = gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD;
    rebuildReadingList(bkmks, unreadOnly);
  }
};


// Sidebar initialization
$(async () => {
  gPrefs = await aePrefs.getAllPrefs();
  setScrollableContentHeight();

  $("#empty-instr").html(sanitizeHTML(browser.i18n.getMessage("emptyInstrEx")));
  setCustomizations();
  gSearchBox.init();

  try {
    await initReadingList();
  }
  catch (e) {
    let errMsg = $("<p>").addClass("error").text(e);
    $("#sidebar-content").append(errMsg);
    return;
  }

  initAddLinkBtn();
  initContextMenu.showManualSync = gPrefs.syncEnabled;
  initContextMenu.showOpenInPrivBrws = await browser.extension.isAllowedIncognitoAccess();
  initContextMenu();
});


function setScrollableContentHeight()
{
  let cntHeight = window.innerHeight;
  if (gPrefs.toolbar) {
    cntHeight -= TOOLBAR_HEIGHT;
  }
  if (gPrefs.searchBar) {
    cntHeight -= TOOLBAR_HEIGHT;
  }
  $("#scroll-content").css({height: `${cntHeight}px`});
}


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
      showEmptyMsg();
    }
    else {
      hideEmptyMsg();
      buildReadingList(bkmks, false);
    }
  }
}


function buildReadingList(aBookmarks, aUnreadOnly)
{
  log(`Read Next: ${aBookmarks.length} items.`);
  log(aBookmarks);

  for (let bkmk of aBookmarks) {
    if (aUnreadOnly && !bkmk.unread) {
      continue;
    }
    addReadingListItem(bkmk);
  }
}


function addReadingListItem(aBookmark)
{
  hideEmptyMsg();
  hideNoUnreadMsg();
  
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

  let listItemTitle = $("<div>").addClass("reading-list-item-title").text(aBookmark.title);
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


async function rebuildReadingList(aBookmarks, aUnreadOnly, aReloadFavIcons=false)
{
  hideEmptyMsg();
  hideNoUnreadMsg();
  $("#reading-list").empty();

  if (aReloadFavIcons) {
    gFavIconMap.clear();
    await gFavIconMap.init();
  }
  
  buildReadingList(aBookmarks, aUnreadOnly);
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


async function initAddLinkBtn()
{
  let [actvTab] = await browser.tabs.query({active: true, currentWindow: true});
  let id = getBookmarkIDFromURL(actvTab.url);
  let bkmkExists = await gCmd.getBookmark(id);

  $("#add-link").prop("disabled", bkmkExists);
}


function initContextMenu()
{
  $.contextMenu({
    selector: ".reading-list-item",
    items: {
      openInNewTab: {
        name: browser.i18n.getMessage("mnuOpenNewTab"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          gCmd.openInNewTab(bkmkElt.dataset.id, bkmkElt.dataset.url);
        }
      },
      openInNewWnd: {
        name: browser.i18n.getMessage("mnuOpenNewWnd"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          gCmd.openInNewWnd(bkmkElt.dataset.id, bkmkElt.dataset.url);
        }
      },
      openInNewPrivateWnd: {
        name: browser.i18n.getMessage("mnuOpenNewPrvWnd"),
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
        name: browser.i18n.getMessage("mnuMrkRead"),
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
        name: browser.i18n.getMessage("mnuMrkUnread"),
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
        name: browser.i18n.getMessage("deleteBkmkCxt"),
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
        name: browser.i18n.getMessage("mnuSyncNow"),
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


function setCustomizations()
{
  let cntHeight = window.innerHeight;

  if (gPrefs.toolbar) {
    $("#toolbar").show();
    cntHeight -= TOOLBAR_HEIGHT;
  }
  else {
    $("#toolbar").hide();
  }
  if (gPrefs.searchBar) {
    $("#search-bar").show();
    cntHeight -= TOOLBAR_HEIGHT;
  }
  else {
    $("#search-bar").hide();
  }
  $("#scroll-content").css({height: `${cntHeight}px`});
}


function showEmptyMsg()
{
  $("#welcome").show();
}


function hideEmptyMsg()
{
  $("#welcome").hide();
}


function showNoUnreadMsg()
{
  $("#no-unread").show();
}


function hideNoUnreadMsg()
{
  $("#no-unread").hide();
}


function showMessageBar(aMsgBarStor)
{
  $(`#msgbars, #msgbars > ${aMsgBarStor}`).show();
}


function hideMessageBar()
{
  $("#msgbars, #msgbars > .msgbar").hide();
}


function handleFilterSelection(aEvent)
{
  gReadingListFilter.setFilter(aEvent.target.value);
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
    $("#add-link").prop("disabled", true);
    break;

  case "remove-bookmark-event":
    removeReadingListItem(aMessage.bookmarkID);
    $("#add-link").prop("disabled", false);
    if ($("#reading-list").length == 0) {
      showEmptyMsg();
    }
    break;

  case "reload-bookmarks-event":
    if ($("#reauthz-msgbar").is(":visible")) {
      hideMessageBar();
    }
    let unreadOnly = gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD;
    rebuildReadingList(aMessage.bookmarks, unreadOnly);
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

  case "tab-loading-finish-event":
  case "tab-switching-event":
    $("#add-link").prop("disabled", aMessage.bkmkExists);
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
    $("#reauthz-msgbar-content").text(browser.i18n.getMessage("reauthzMsgBar", aMessage.fileHostName));
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

  setCustomizations();

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


$(window).on("resize", aEvent => {
  setScrollableContentHeight();
});


$("#add-link, #add-link-cta").on("click", async (aEvent) => {
  let [actvTab] = await browser.tabs.query({active: true, currentWindow: true});
  let title = sanitizeHTML(actvTab.title);
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
 
  hideEmptyMsg();
  hideNoUnreadMsg();

  if (gPrefs.closeTabAfterAdd) {
    gCmd.closeTab(actvTab.id);
  }
});


$("#setup-sync").on("click", aEvent => {
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


$("#filter-all").click(handleFilterSelection);

$("#filter-unread").click(handleFilterSelection);

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

$("#reauthz-msgbar > .msgbar-dismiss").on("click", aEvent => {
  hideMessageBar();
});


$(document).on("contextmenu", aEvent => {
  aEvent.preventDefault();
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


function log(aMessage)
{
  if (aeConst.DEBUG) { console.log(aMessage) }
}


function warn(aMessage)
{
  if (aeConst.DEBUG) { console.warn(aMessage) }
}
