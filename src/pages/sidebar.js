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
    log(`Read Next: Navigating to url: ${aURL}`);
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
      console.error("gCmd.addBookmark(): " + e);
      throw e;
    }
  },

  deleteBookmark(aBookmarkID)
  {
    let msg = {
      id: "remove-bookmark",
      bookmarkID: aBookmarkID,
    };
    
    browser.runtime.sendMessage(msg);
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

  syncBookmarks()
  {
    browser.runtime.sendMessage({id: "sync-reading-list"});
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
    else {
      // TO DO: Set the bookmark status to "Read" in the reading list.
      // Again, do this after the page has finished loading.
    }
  },
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

  await initReadingList();

  initContextMenu.showManualSync = gPrefs.syncEnabled;
  initContextMenu.showOpenInPrivBrws = await browser.extension.isAllowedIncognitoAccess();
  initContextMenu();
});


async function initReadingList()
{
  log("Read Next::sidebar.js: initReadingList(): Initializing sidebar.");

  if (gPrefs.syncEnabled) {
    log("Read Next::sidebar.js: initReadingList(): Sync enabled.  Syncing reading list.");
    gCmd.syncBookmarks();
  }
  else {
    let bkmks = await gCmd.getBookmarks();
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
  let listItem = $("<div>").addClass("reading-list-item").attr("title", tooltipText)[0];
  listItem.dataset.id = aBookmark.id;
  listItem.dataset.title = aBookmark.title;
  listItem.dataset.url = aBookmark.url;

  let listItemTitle = $("<span>").addClass("reading-list-item-title").text(aBookmark.title);
  $("#reading-list").append($(listItem).append(listItemTitle));
}


function removeReadingListItem(aBookmarkID)
{
  let bkmkElt = $(`.reading-list-item[data-id="${aBookmarkID}"]`);
  bkmkElt.fadeOut(800);
}


async function rebuildReadingList(aBookmarks)
{
  hideWelcome();
  $("#reading-list").empty();
  buildReadingList(aBookmarks);
}


function initContextMenu()
{
  $.contextMenu({
    selector: ".reading-list-item",
    items: {
      openInNewTab: {
        name: "open in new tab",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          gCmd.openInNewTab(bkmkElt.dataset.id, bkmkElt.dataset.url);
        }
      },
      openInNewWnd: {
        name: "open in new window",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          gCmd.openInNewWnd(bkmkElt.dataset.id, bkmkElt.dataset.url);
        }
      },
      openInNewPrivateWnd: {
        name: "open in new private window",
        async callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          let url = bkmkElt.dataset.url;
          gCmd.openInNewPrivateWnd(bkmkElt.dataset.id, bkmkElt.dataset.url);
        },
        visible(aKey, aOpt) {
          return initContextMenu.showOpenInPrivBrws;
        }
      },
      deleteBkmkSep: "---",
      deleteBookmark: {
        name: "delete",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          let bkmkID = bkmkElt.dataset.id;
          log(`Read Next::sidebar.js: Removing bookmark ID: ${bkmkID}`);

          gCmd.deleteBookmark(bkmkID);
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


function showError(aMessage)
{
  $("#error-msg").text(aMessage);
  $("#error").show();
}


function updateLoadingStatus()
{
  let loadingStatus = $("#loading");
  let isHidden = window.getComputedStyle(loadingStatus[0]).getPropertyValue("display") == "none";
  if (isHidden) {
    loadingStatus.css({display: "block"});
  }
  let currentProgress = $("#progress-bar").text();
  $("#progress-bar").text(currentProgress.concat("\u2219"));
}


function hideLoadingStatus()
{
  $("#loading").css({display: "none"});
  $("#progress-bar").text("");
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


//
// Event handlers
//

browser.runtime.onMessage.addListener(async (aMessage) => {
  if (aeConst.DEBUG) {
    let wnd = await browser.windows.getCurrent();
    log(`Read Next::sidebar.js: [Window ID: ${wnd.id}] Received extension message "${aMessage.id}"`);
  }

  switch (aMessage.id) {
  case "add-bookmark-event":
    addReadingListItem(aMessage.bookmark);
    break;

  case "remove-bookmark-event":
    removeReadingListItem(aMessage.bookmarkID);
    break;
    
  case "reload-bookmarks-event":
    rebuildReadingList(aMessage.bookmarks);
    break;
    
  case "sync-setting-changed":
    initContextMenu.showManualSync = aMessage.syncEnabled;
    break;

  default:
    break;
  }
});


$("#add-link").on("click", async (aEvent) => {
  let tabs = await browser.tabs.query({active: true, currentWindow: true});
  let title = tabs[0].title;
  let url = tabs[0].url;
  let id = getBookmarkIDFromURL(url);
  let bkmk = new aeBookmark(id, url, title);

  try {
    await gCmd.addBookmark(bkmk);
  }
  catch (e) {
    console.error("Read Next: Error adding bookmark: " + e);
    return;
  }
 
  hideWelcome();  
});


$("#setup").on("click", aEvent => {
  browser.runtime.openOptionsPage();
});


$("#reading-list").on("click", async (aEvent) => {
  let readingListItem;
  if (aEvent.target.className == "reading-list-item-title") {
    readingListItem = aEvent.target.parentNode;
  }
  else if (aEvent.target.className == "reading-list-item") {
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
