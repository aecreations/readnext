/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let gReadingList;

// Context menu commands
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

  deleteBookmark(aBookmarkID)
  {
    gReadingList.remove(aBookmarkID);
  },

  // Helper
  async _afterBookmarkOpened(aBookmarkID)
  {
    let deleteReadLinks = await aePrefs.getPref("deleteReadLinks");
    if (deleteReadLinks) {
      // TEMPORARY
      // TO DO: Delete the bookmark after the page has finished loading.
      setTimeout(() => { this.deleteBookmark(aBookmarkID) }, 3000);
      // END TEMPORARY
    }
    else {
      // TO DO: Set the bookmark status to "Read" in the reading list
    }
  },
};


// Sidebar initializion
$(async () => {
  // TO DO: Is this still needed? Should this be done in the background script?
  let syncEnabledFromExtPrefs = await aePrefs.getPref("syncEnabledFromExtPrefs");
  if (syncEnabledFromExtPrefs) {
    await aePrefs.setPrefs({syncEnabledFromExtPrefs: false});
  }
  // END TO DO

  await initReadingList();

  initContextMenu.showOpenInPrivBrwsOpt = await browser.extension.isAllowedIncognitoAccess();
  initContextMenu();
});


async function initReadingList()
{
  log("Read Next::sidebar.js: initReadingList(): Initializing sidebar.");

  gReadingList = new aeReadingListSidebar();

  let syncEnabled = await aePrefs.getPref("syncEnabled");
  if (syncEnabled) {
    log("Read Next::sidebar.js: initReadingList(): Sync enabled.  Syncing reading list.");
    gReadingList.sync();
  }
  else {
    let bkmks = await gReadingList.getAll();
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
          return initContextMenu.showOpenInPrivBrwsOpt;
        }
      },
      separator: "---",
      deleteBookmark: {
        name: "delete",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          let bkmkID = bkmkElt.dataset.id;
          log(`Read Next::sidebar.js: Removing bookmark ID: ${bkmkID}`);

          gCmd.deleteBookmark(bkmkID);
        }
      }
    }
  });
}
initContextMenu.showOpenInPrivBrwsOpt = false;


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
    
  case "sync-disconnected-from-ext-prefs":
    warn("Read Next: Sync turned off from extension preferences page.");
    break;

  default:
    break;
  }
});


browser.windows.onFocusChanged.addListener(async (aWndID) => {
  let wnd = await browser.windows.getCurrent();
  if (wnd.id == aWndID) {
    let syncEnabled = await aePrefs.getPref("syncEnabled");
    if (syncEnabled) {
      log(`Read Next::sidebar.js: [Window ID: ${wnd.id}] Handling window focus changed event - syncing reading list.`);
      gReadingList.sync();
    }
  }
});


$("#add-link").on("click", async (aEvent) => {
  let tabs = await browser.tabs.query({active: true, currentWindow: true});
  let title = tabs[0].title;
  let url = tabs[0].url;
  let id = gReadingList.getIDFromURL(url);
  let bkmk = new aeBookmark(id, url, title);
  let bkmkID;
  try {
    bkmkID = await gReadingList.add(bkmk);
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


$(document).on("contextmenu", aEvent => {
  aEvent.preventDefault();
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
