/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const TOOLBAR_HEIGHT = 28;

let gWndID;
let gPrefs;
let gCustomizeDlg, gRenameDlg;
let gKeybSelectedIdx = null;
let gPrefersColorSchemeMedQry;
let gMsgBarTimerID = null;

// Sidebar actions
let gCmd = {
  async open(aBookmarkID, aURL)
  {
    let url = processURL(aURL);
    let [actvTab] = await browser.tabs.query({active: true, currentWindow: true});

    browser.runtime.sendMessage({
      id: "open-link-curr-wnd",
      activeTabID: actvTab.id,
      url,
    });
  },

  openInNewTab(aBookmarkID, aURL)
  {
    let url = processURL(aURL);
    browser.tabs.create({url});
  },

  openInNewWnd(aBookmarkID, aURL)
  {
    let url = processURL(aURL);
    browser.windows.create({url});
  },

  async openInNewPrivateWnd(aBookmarkID, aURL)
  {
    let url = processURL(aURL);
    try {
      await browser.windows.create({url, incognito: true});
    }
    catch (e) {
      console.error("Read Next::sidebar.js: gCmd.openInNewPrivateWnd(): Error from sidebar context menu: " + e);
    }
  },

  async addBookmark(aBookmark)
  {
    if (! aBookmark.id) {
      throw new Error("Bookmark ID is invalid or undefined");
    }

    let currWnd = await browser.windows.getCurrent();
    let msg = {
      id: "add-bookmark",
      bookmark: aBookmark,
      windowID: currWnd.id,
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
    let currWnd = await browser.windows.getCurrent();
    let msg = {
      id: "remove-bookmark",
      bookmarkID: aBookmarkID,
      windowID: currWnd.id,
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

  async syncBookmarks(aShowLoadingProgress=false)
  {
    if (aShowLoadingProgress) {
      clearReadingList();
      showLoadingProgress();
    }

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

  rename(aBookmarkID)
  {
    let bkmk = $(`.reading-list-item[data-id="${aBookmarkID}"]`);
    gRenameDlg.setBookmark(bkmk.attr("data-id"), bkmk.attr("data-title"));
    gRenameDlg.showModal();
  },

  async closeTab(aTabID)
  {
    await browser.runtime.sendMessage({
      id: "close-tab",
      tabID: aTabID,
    });
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
      toggleSearchBarVisibility(false);
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
        if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(aEvent.key)) {
          return;
        }
        if (aEvent.key == "Escape") {
          this.reset();
        }
        else {
          this.updateSearch();
          $("#clear-search").css({
            visibility: (aEvent.target.value ? "visible" : "hidden")
          });
        }
      });

    $("#clear-search").click(aEvent => { this.reset() });

    this._isInitialized = true;
  },

  isActivated()
  {
    return this._isActive;
  },

  isSearchInProgress()
  {
    return ($("#search-box").val() != "");
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

    if (srchResults.length == 0) {
      clearReadingList();
      hideEmptyMsg();
      hideNoUnreadMsg();
      showNotFoundMsg();
      return;
    }
    
    let unreadOnly = gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD;
    await rebuildReadingList(srchResults, unreadOnly);
  },

  async isInSearchResult(aSearchText)
  {
    let rv = false;
    let srchResults = await browser.runtime.sendMessage({
      id: "search-bookmarks",
      searchTerms: $("#search-box").val(),
    });

    if (srchResults.length > 0) {
      let findIdx = srchResults.findIndex(aItem => aItem.title == aSearchText);
      rv = findIdx != -1;
    }
    
    return rv;
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
    hideNotFoundMsg();

    let bkmks = await gCmd.getBookmarks();
    if (bkmks.length == 0) {
      toggleSearchBarVisibility(false);
      clearReadingList();
      showEmptyMsg();
      return;
    }

    let unreadOnly = gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD;
    if (unreadOnly) {
      let unreadBkmks = bkmks.filter(aBkmk => aBkmk.unread);
      if (unreadBkmks.length == 0) {
        showNoUnreadMsg();
        return;
      }
    }
    
    rebuildReadingList(bkmks, unreadOnly);
  }
};


// Sidebar initialization
$(async () => {
  let {os} = await browser.runtime.getPlatformInfo();
  document.body.dataset.os = os;

  // UI fix for Firefox 132 and newer.
  let {version} = await browser.runtime.getBrowserInfo();
  document.body.dataset.tbarFix = aeVersionCmp("132.0", version) <= 0;
  
  log(`Read Next: Sidebar width ${window.innerWidth} px`);

  let lang = browser.i18n.getUILanguage();
  document.body.dataset.locale = lang;

  gPrefs = await aePrefs.getAllPrefs();
  setScrollableContentHeight();

  let strKey = gPrefs.showPageAction ? "emptyInstrEx" : "emptyInstr";
  $("#empty-instr").html(sanitizeHTML(browser.i18n.getMessage(strKey)));
  setCustomizations();
  gSearchBox.init();

  // Handle changes to Dark Mode system setting.
  gPrefersColorSchemeMedQry = window.matchMedia("(prefers-color-scheme: dark)");
  gPrefersColorSchemeMedQry.addEventListener("change", handlePrefersColorSchemeChange);
  addReadingListItem.isDarkMode = gPrefersColorSchemeMedQry.matches;

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
  initDialogs();

  // Show update message bar if Read Next was just updated.
  let {verUpdateType, showBanner} = await browser.runtime.sendMessage({id: "get-ver-update-info"});
  if (verUpdateType && showBanner) {
    showVersionUpdateMsgBar(verUpdateType);
  }

  let currWnd = await browser.windows.getCurrent();
  gWndID = currWnd.id;

  // Preload toolbar button icon
  let addLinkIco = new Image();
  addLinkIco.src = "../img/add-link-hover.svg";
});


async function showVersionUpdateMsgBar(aVersionUpdateType)
{
  if (aVersionUpdateType == aeConst.VER_UPDATE_TYPE_MAJOR) {
    // Check if What's New page is already open.
    let isWhatsNewPgOpen = false;
    try {
      let resp = await browser.runtime.sendMessage({id: "ping-whats-new-pg"});
      isWhatsNewPgOpen = !!resp;
    }
    catch {}

    if (! isWhatsNewPgOpen) {
      showMessageBar("#upgrade-msgbar");
    }
  }
  else {
    showMessageBar("#update-msgbar");
  }

  gMsgBarTimerID = setTimeout(() => {
    hideMessageBar("#update-msgbar");
  }, aeConst.MSGBAR_DELAY_MS);
}


function showNetworkConnectErrorMsgBar(aFileHostName)
{
  $("#neterr-msgbar-content").text(browser.i18n.getMessage("errNoConn", aFileHostName));
  showMessageBar("#neterr-msgbar");
}


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

  showLoadingProgress();

  await gFavIconMap.init();

  if (gPrefs.syncEnabled && !aLocalDataOnly) {
    log("Read Next::sidebar.js: initReadingList(): Sync enabled.  Syncing reading list.");
    await gCmd.syncBookmarks();
  }
  else {
    let bkmks = await gCmd.getBookmarks();
    if (! bkmks) {
      hideLoadingProgress();
      throw new Error("Failed to load reading list");
    }

    if (bkmks.length == 0) {
      hideLoadingProgress();
      showEmptyMsg();
      toggleSearchBarVisibility(false);
    }
    else {
      hideLoadingProgress();
      hideEmptyMsg();
      await buildReadingList(bkmks, false);
    }
  }
}


async function buildReadingList(aBookmarks, aUnreadOnly)
{
  log(`Read Next: ${aBookmarks.length} items.`);
  log(aBookmarks);

  if (aBookmarks.length == 0) {
    toggleSearchBarVisibility(false);
    return;
  }
  else {
    toggleSearchBarVisibility(true);
    enableReadingListKeyboardNav();
  }

  for (let bkmk of aBookmarks) {
    if (aUnreadOnly && !bkmk.unread) {
      continue;
    }
    await addReadingListItem(bkmk);
  }
}


async function addReadingListItem(aBookmark)
{
  if (gSearchBox.isSearchInProgress()) {
    if (await gSearchBox.isInSearchResult(aBookmark.title)) {
      hideNotFoundMsg();
    }
    else {
      return;
    }
  }

  hideEmptyMsg();
  hideNoUnreadMsg();
  hideLoadingProgress();
  toggleSearchBarVisibility(true);
  
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

  let favIconCanvas = $("<canvas>").addClass("favicon").css({width: "16px", height: "16px"})[0];
  let scale = window.devicePixelRatio;
  favIconCanvas.width = Math.floor(16 * scale);
  favIconCanvas.height = Math.floor(16 * scale);
  
  let canvasCtx = favIconCanvas.getContext("2d");
  canvasCtx.scale(scale, scale);
  
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
    if (addReadingListItem.isDarkMode) {
      img.src = aeConst.DEFAULT_FAVICON_DK;
    }
    else {
      img.src = aeConst.DEFAULT_FAVICON; 
    }
  }

  let listItemTitle = $("<div>").addClass("reading-list-item-title").text(aBookmark.title);
  let listItem = $(listItemDiv);
  listItem.append(favIconCanvas);
  listItem.append(listItemTitle);
  $("#reading-list").append(listItem);

  if (isReadingListKeyboardNavDisabled()) {
    enableReadingListKeyboardNav();
  }
}
addReadingListItem.isDarkMode = false;


function removeReadingListItem(aBookmarkID)
{
  let bkmkElt = $(`.reading-list-item[data-id="${aBookmarkID}"]`);
  bkmkElt.fadeOut(800, function () {
    this.remove();
    if (isReadingListEmpty()) {
      if (gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD) {
        gSearchBox.reset();
      }
      else {
        if (! gSearchBox.isSearchInProgress()) {
          gSearchBox.reset();
          showEmptyMsg();
        }
      }
      disableReadingListKeyboardNav();        
    }
    else {
      if (gKeybSelectedIdx !== null) {
        let numItems = $("#reading-list").children().length;
        if (gKeybSelectedIdx > numItems - 1) {
          // Handle deletion of last reading list item.
          gKeybSelectedIdx--;
        }
        else {
          $("#reading-list").children().removeClass("focused");
        }
        $("#reading-list").children().get(gKeybSelectedIdx).classList.add("focused");
      }
    }
  });
}


async function rebuildReadingList(aBookmarks, aUnreadOnly, aReloadFavIcons=false)
{
  hideEmptyMsg();
  hideNoUnreadMsg();
  clearReadingList();

  if (aReloadFavIcons) {
    gFavIconMap.clear();
    await gFavIconMap.init();
  }

  let mediaQry = window.matchMedia("(prefers-color-scheme: dark)");
  addReadingListItem.isDarkMode = mediaQry.matches;
  
  await buildReadingList(aBookmarks, aUnreadOnly);
}


function isReadingListEmpty()
{
  return ($("#reading-list").children().length == 0);
}


function clearReadingList()
{
  $("#reading-list").empty();
  disableReadingListKeyboardNav();
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

  $("#add-link, #add-link-cta").prop("disabled", (bkmkExists || !isSupportedURL(actvTab.url)));
}


function initDialogs()
{
  gRenameDlg = new aeDialog("#rename-dlg");
  gRenameDlg.setProps({bkmkID: null});
  gRenameDlg.setBookmark = function (aBookmarkID, aName)
  {
    this.bkmkID = aBookmarkID;
    this.find("#new-link-name").val(aName);
  };
  gRenameDlg.onInit = function ()
  {
    let textarea = this.find("#new-link-name")[0];
    textarea.select();
  };
  gRenameDlg.onAccept = async function ()
  {
    let textarea = this.find("#new-link-name")[0];
    let newName = sanitizeHTML(textarea.value);
    if (newName == "") {
      textarea.focus();
      textarea.select();
      return;
    }

    await browser.runtime.sendMessage({
      id: "rename-bookmark",
      bookmarkID: this.bkmkID,
      newName,
    });

    // Update the link name in the reading list.
    let listItem = $(`.reading-list-item[data-id="${this.bkmkID}"]`);
    let title = listItem.find(".reading-list-item-title");
    title.text(newName);
    listItem.attr("data-title", newName);

    // Update the tooltip for the reading list item.
    let bkmkURL = listItem.attr("data-url");
    let tooltipText = `${newName}\n${bkmkURL}`;
    listItem.attr("title", tooltipText);

    this.bkmkID = null;
    this.close();
  };
  gRenameDlg.isOpen = function ()
  {
    return this._dlgElt.hasClass("lightbox-show");
  };

  gCustomizeDlg = new aeDialog("#customize-dlg");
  gCustomizeDlg.onFirstInit = function ()
  {
    $("#unread-links-bold-label").html(sanitizeHTML(browser.i18n.getMessage("prefUnreadBold")));
  };
  gCustomizeDlg.onInit = function ()
  {
    $("#unread-links-bold").prop("checked", gPrefs.boldUnreadBkmks).on("click", aEvent => {
      aePrefs.setPrefs({boldUnreadBkmks: aEvent.target.checked});
    });

    $("#show-toolbar").prop("checked", gPrefs.toolbar).on("click", aEvent => {
      aePrefs.setPrefs({toolbar: aEvent.target.checked});
    });

    $("#show-search-bar").prop("checked", gPrefs.searchBar).on("click", aEvent => {
      aePrefs.setPrefs({searchBar: aEvent.target.checked});
    });
  };
}


function initContextMenu()
{
  $.contextMenu({
    selector: ".reading-list-item",
    items: {
      openInCurrentTab: {
        name: browser.i18n.getMessage("mnuOpen"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          gCmd.open(bkmkElt.dataset.id, bkmkElt.dataset.url);
          gPrefs.closeSidebarAfterNav && browser.sidebarAction.close();
        },
        visible(aKey, aOpt) {
          return (gPrefs.linkClickAction == aeConst.OPEN_LINK_IN_NEW_TAB);
        }
      },
      openInNewTab: {
        name: browser.i18n.getMessage("mnuOpenNewTab"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          gCmd.openInNewTab(bkmkElt.dataset.id, bkmkElt.dataset.url);
          gPrefs.closeSidebarAfterNav && browser.sidebarAction.close();
        }
      },
      openInNewWnd: {
        name: browser.i18n.getMessage("mnuOpenNewWnd"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          gCmd.openInNewWnd(bkmkElt.dataset.id, bkmkElt.dataset.url);
          gPrefs.closeSidebarAfterNav && browser.sidebarAction.close();
        }
      },
      openInNewPrivateWnd: {
        name: browser.i18n.getMessage("mnuOpenNewPrvWnd"),
        className: "ae-menuitem",
        async callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          let url = bkmkElt.dataset.url;
          gCmd.openInNewPrivateWnd(bkmkElt.dataset.id, bkmkElt.dataset.url);
          gPrefs.closeSidebarAfterNav && browser.sidebarAction.close();
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
      renameBookmark: {
        name: browser.i18n.getMessage("renameBkmkCxt"),
        className: "ae-menuitem",
        async callback(aKey, aOpt) {
          let bkmkElt = aOpt.$trigger[0];
          let bkmkID = bkmkElt.dataset.id;
          gCmd.rename(bkmkID);
        },
        visible(aKey, aOpt) {
          return (gPrefs.allowEditLinks == true);
        },
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
          gCmd.syncBookmarks(true);
        },
        visible(aKey, aOpt) {
          return initContextMenu.showManualSync;
        }
      },
      custzSep: "---",
      customize: {
        name: browser.i18n.getMessage("mnuCustz"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          gCustomizeDlg.showModal();
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

  let msgBarsCSS = window.getComputedStyle($("#msgbars")[0]);
  let msgBarsHeight = parseInt(msgBarsCSS.getPropertyValue("height"));
  if (isNaN(msgBarsHeight)) {
    msgBarsHeight = 0;
  }
  cntHeight -= msgBarsHeight;

  $("#scroll-content").css({height: `${cntHeight}px`});
}


async function handlePrefersColorSchemeChange(aMediaQuery)
{
  let bkmks = await gCmd.getBookmarks();
  if (bkmks.length > 0) {
    let unreadOnly = gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD;
    await rebuildReadingList(bkmks, unreadOnly);
  }
}


function showEmptyMsg()
{
  if (gPrefs.syncEnabled) {
    $("#sync-cta").hide();
  }
  else {
    $("#sync-cta").show();
  }

  $("#welcome").show();
}


function isEmptyMsgVisible()
{
  return $("#welcome").is(":visible");
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


function showNotFoundMsg()
{
  $("#not-found").show();
}


function hideNotFoundMsg()
{
  $("#not-found").hide();
}


function showLoadingProgress()
{
  if (isEmptyMsgVisible()) {
    hideEmptyMsg();
  }
  $("#search-box").attr("disabled", "true");
  $("#loading").show();
}


function hideLoadingProgress()
{
  $("#loading").hide();
  $("#search-box").removeAttr("disabled");
}


function showMessageBar(aMsgBarStor)
{
  $(`#msgbars > ${aMsgBarStor}`).css({display: "flex"});
  if (! $("#msgbars").hasClass("msgbars-visible")) {
    $("#msgbars").addClass("msgbars-visible");
  }
  
  setCustomizations();
}


function hideMessageBar(aMsgBarStor)
{
  $(`#msgbars > ${aMsgBarStor}`).css({display: "none"});
  if (! $("#msgbars").children().is(":visible")) {
    $("#msgbars").removeClass("msgbars-visible");
  }
  
  setCustomizations();
}


function toggleSearchBarVisibility(aIsVisible)
{
  let visibility = aIsVisible ? "visible" : "hidden";
  $("#search-bar").css({visibility});

  // Also enable or disable the link filter radio buttons.
  if (aIsVisible) {
    $('#bookmark-filter input[type="radio"]').removeAttr("disabled");
  }
  else {
    $('#bookmark-filter input[type="radio"]').attr("disabled", true);
  }
}


function handleFilterSelection(aEvent)
{
  gReadingListFilter.setFilter(aEvent.target.value);
}


function enableReadingListKeyboardNav()
{
  $("#reading-list").attr("tabindex", "0");

  $("#reading-list").on("keydown.readingList", aEvent => {
    if (isReadingListEmpty()) {
      return;
    }

    // Ignore key press if the context menu is open.
    if ($(".context-menu-active").length > 0) {
      aEvent.preventDefault();
      return;
    }

    let numItems = $("#reading-list").children().length;
    
    if (aEvent.key == "ArrowDown") {
      if (gKeybSelectedIdx === null) {
        gKeybSelectedIdx = 0;
      }
      else if (gKeybSelectedIdx == numItems - 1) {
        warn("Read Next::sidebar.js: Reached the end of the reading list.");
      }
      else {
        $("#reading-list").children().get(gKeybSelectedIdx).classList.remove("focused");
        gKeybSelectedIdx++;
      }

      let readingListItem = $("#reading-list").children().get(gKeybSelectedIdx);
      readingListItem.classList.add("focused");
      readingListItem.scrollIntoView({block: "end", behavior: "smooth"});

      aEvent.preventDefault();
    }
    else if (aEvent.key == "ArrowUp") {
      if (! gKeybSelectedIdx) {
        warn("Read Next::sidebar.js: Reached the start of the reading list.");
      }
      else {
        $("#reading-list").children().get(gKeybSelectedIdx).classList.remove("focused");
        gKeybSelectedIdx--;
      }

      let readingListItem = $("#reading-list").children().get(gKeybSelectedIdx);
      readingListItem.classList.add("focused");
      readingListItem.scrollIntoView({block: "start", behavior: "smooth"});

      aEvent.preventDefault();
    }
    else if (aEvent.key == "Enter" || aEvent.key == " ") {
      let readingListItem = $("#reading-list").children().get(gKeybSelectedIdx);
      gCmd.open(readingListItem.dataset.id, readingListItem.dataset.url);

      aEvent.preventDefault();
    }
  });
}


function disableReadingListKeyboardNav()
{
  $("#reading-list").removeAttr("tabindex");
  $("#reading-list").off("keydown.readingList");
  gKeybSelectedIdx = null;
}


function isReadingListKeyboardNavDisabled()
{
  return ($("#reading-list").attr("tabindex") === undefined);
}


//
// Event handlers
//

browser.runtime.onMessage.addListener(aMessage => {
  log(`Read Next::sidebar.js: Window ID ${gWndID} received extension message "${aMessage.id}"`);

  let resp = null;

  switch (aMessage.id) {
  case "add-bookmark-event":
    addReadingListItem(aMessage.bookmark).then(() => {
      return browser.tabs.query({active: true, currentWindow: true});
    }).then(aTabs => {
      let actvTab = aTabs[0];
      if (aMessage.bookmark.url == actvTab.url) {
        $("#add-link, #add-link-cta").prop("disabled", true);
      }
    });
    break;

  case "remove-bookmark-event":
    removeReadingListItem(aMessage.bookmark.id);
    browser.tabs.query({active: true, currentWindow: true}).then(aTabs => {
      let actvTab = aTabs[0];
      if (aMessage.bookmark.url == actvTab.url) {
        $("#add-link, #add-link-cta").prop("disabled", false);
      }
    });
    break;

  case "reload-bookmarks-event":
    if ($("#reauthz-msgbar").is(":visible")) {
      hideMessageBar("#reauthz-msgbar");
    }
    if ($("#neterr-msgbar").is(":visible")) {
      hideMessageBar("#neterr-msgbar");
    }
    hideLoadingProgress();

    if (aMessage.bookmarks.length == 0) {
      showEmptyMsg();
      return;
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
    browser.windows.getCurrent().then(aCurrWnd => {
      log(`Read Next::sidebar.js: Handling message "${aMessage.id}"\nOriginating window ID of message: ${aMessage.windowID}; Current window ID: ${aCurrWnd.id}`);
      if (aCurrWnd.id == aMessage.windowID) {
        $("#add-link, #add-link-cta").prop("disabled", (aMessage.bkmkExists || !aMessage.isSupportedURL));
      }
    });
    break;

  case "sync-setting-changed":
    if (aMessage.syncEnabled) {
      hideEmptyMsg();
      hideNoUnreadMsg();
      hideNotFoundMsg();
      clearReadingList();
      showLoadingProgress();
    }
    else {
      if ($("#reauthz-msgbar").is(":visible")) {
        hideMessageBar("#reauthz-msgbar");
      }
      if ($("#neterr-msgbar").is(":visible")) {
        hideMessageBar("#neterr-msgbar");
      }
    }
    initContextMenu.showManualSync = aMessage.syncEnabled;
    // The message listener in the background script for the same message
    // returns a promise, so do the same here.
    return Promise.resolve();

  case "sync-failed-authz-error":
    if (isReadingListEmpty()) {
      initReadingList(true);
    }
    break;

  case "sync-failed-netwk-error":
    showNetworkConnectErrorMsgBar(aMessage.fileHostName);
    if (isReadingListEmpty()) {
      initReadingList(true);
    }
    break;

  case "reauthorize-prompt":
    $("#reauthz-msgbar-content").text(browser.i18n.getMessage("reauthzMsgBar", aMessage.fileHostName));
    showMessageBar("#reauthz-msgbar");
    break;

  case "whats-new-pg-open-evt":
    hideMessageBar("#upgrade-msgbar");
    break;

  default:
    break;
  }

  if (resp) {
    return Promise.resolve(resp);
  }
});


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
  warn("Read Next::sidebar.js: The 'resize' event was fired!!");
  // The "resize" event is sometimes fired when the sidebar is shown, but
  // before it is initialized.
  if (! gPrefs) {
    return;
  }
  setScrollableContentHeight();
});


$("#add-link, #add-link-cta").on("click", async (aEvent) => {
  let [actvTab] = await browser.tabs.query({active: true, currentWindow: true});
  let title = sanitizeHTML(actvTab.title);
  let url = processURL(actvTab.url);
  let id = getBookmarkIDFromURL(url);
  let bkmk = new aeBookmark(id, url, title);

  let iconURL = actvTab.favIconUrl;
  if (iconURL) {
    gFavIconMap.add(id, iconURL);
  }

  if (actvTab.isInReaderMode) {
    bkmk.readerMode = true;
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


$("#setup-sync").on("click", async (aEvent) => {
  await browser.runtime.sendMessage({id: "enable-auto-open-connect-wiz"});
  browser.runtime.openOptionsPage();
});


$("#reading-list").on("click", aEvent => {
  let readingListItem;
  if (aEvent.target.className == "reading-list-item-title"
      || aEvent.target.className == "favicon") {
    readingListItem = aEvent.target.parentNode;
  }
  else if (aEvent.target.classList.contains("reading-list-item")) {
    readingListItem = aEvent.target;
  }

  if (gPrefs.linkClickAction == aeConst.OPEN_LINK_IN_NEW_TAB) {
    gCmd.openInNewTab(readingListItem.dataset.id, readingListItem.dataset.url);
  }
  else {
    // Default to opening in current tab.
    gCmd.open(readingListItem.dataset.id, readingListItem.dataset.url);
  }

  if (gPrefs.closeSidebarAfterNav) {
    browser.sidebarAction.close();
  }
});


$("#reading-list").on("focus", aEvent => {
  if (whatInput.ask() == "keyboard") {
    gKeybSelectedIdx === null && (gKeybSelectedIdx = 0);
    $("#reading-list").children().removeClass("focused");
    $("#reading-list").children().get(gKeybSelectedIdx).classList.add("focused");
  } 
});


$("#reading-list").on("blur", aEvent => {
  $("#reading-list").children().removeClass("focused");
});


$("#filter-all").click(handleFilterSelection)
  .on("focus", aEvent => { $('#bookmark-filter > input[type="radio"] ~ label').addClass("focused") })
  .on("blur", aEvent => { $('#bookmark-filter > input[type="radio"] ~ label').removeClass("focused") });


$("#filter-unread").click(handleFilterSelection)
  .on("focus", aEvent => { $('#bookmark-filter > input[type="radio"] ~ label').addClass("focused") })
  .on("blur", aEvent => { $('#bookmark-filter > input[type="radio"] ~ label').removeClass("focused") });


$("#search-box").focus(aEvent => {
  gSearchBox.activate();
});

$("#show-whats-new").on("click", aEvent => {
  browser.tabs.create({url: browser.runtime.getURL("pages/whatsnew.html")});
});

$("#reauthorize").on("click", aEvent => {
  browser.runtime.sendMessage({id: "reauthorize"});
});

$("#retry-sync").on("click", aEvent => {
  gCmd.syncBookmarks(true);
  hideMessageBar("#neterr-msgbar");
});

$(".inline-msgbar > .inline-msgbar-dismiss").on("click", aEvent => {
  let msgBarID = aEvent.target.parentNode.id;
  hideMessageBar(`#${msgBarID}`);
  gMsgBarTimerID && clearTimeout(gMsgBarTimerID);    
});


$(window).keydown(aEvent => {
  if (aEvent.key == "Enter") {
    if (aeDialog.isOpen()) {
      if (aEvent.target.tagName == "BUTTON" && !aEvent.target.classList.contains("default")) {
        aEvent.target.click();
      }
      else {
        aeDialog.acceptDlgs();
      }
    }
    else {
      if (aEvent.target.tagName == "BUTTON") {
        aEvent.target.click();
      }
    }
    aEvent.preventDefault();
  }
  else if (aEvent.key == "Escape" && aeDialog.isOpen()) {
    aeDialog.cancelDlgs();
  }
  else if (aEvent.key == "F10" && aEvent.shiftKey) {
    let focusedBkmk = $(".reading-list-item.focused");
    if (focusedBkmk.length == 1) {
      focusedBkmk.first().trigger("contextmenu");
    }
  }
});


$(document).on("contextmenu", aEvent => {
  aEvent.preventDefault();
});


//
// Utilities
//

function sanitizeHTML(aHTMLStr)
{
  return DOMPurify.sanitize(aHTMLStr, {SAFE_FOR_JQUERY: true});
}


function getBookmarkIDFromURL(aURL)
{
  return md5(aURL);
}


function isSupportedURL(aURL)
{
  return (aURL.startsWith("http") || aURL.startsWith("about:reader"));
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


function warn(aMessage)
{
  if (aeConst.DEBUG) { console.warn(aMessage) }
}
