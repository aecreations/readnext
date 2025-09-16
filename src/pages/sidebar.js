/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const TOOLBAR_HEIGHT = 28;

let gOS;
let gWndID;
let gPrefs;
let gCustomizeDlg, gRenameDlg, gRenameOtherWndMsgBox, gKeybdCxtMenu;
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

  async rename(aBookmarkID)
  {
    // Check if renaming a link is in progress in any other browser window.
    let resp = await browser.runtime.sendMessage({id: "can-edit-bookmark?"});

    if (!resp.canEditBkmk) {
      gRenameOtherWndMsgBox.setOtherWndID(resp.renameDlgSrcWndID);
      gRenameOtherWndMsgBox.showModal();
      return;
    }
    
    let bkmk = $(`.reading-list-item[data-id="${aBookmarkID}"]`);
    gRenameDlg.setBookmark(bkmk.attr("data-id"), bkmk.attr("data-title"));
    gRenameDlg.showModal();
  },

  cancelRename()
  {
    if (gRenameDlg.isOpen()) {
      gRenameDlg.close();
    }
    if (gRenameOtherWndMsgBox.isOpen()) {
      gRenameOtherWndMsgBox.close();
    }
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

    if (this._filter == this.UNREAD && gSearchBox.isSearchInProgress()) {
      let srchBkmk = await browser.runtime.sendMessage({
        id: "search-bookmarks",
        searchTerms: gSearchBox.getSearchText(),
      });

      for (let item of srchBkmk) {
        if (!item.unread) {
          // The link matching the search term is found, but isn't unread.
          // Show "No items found" message, which is more accurate than
          // "No unread items"
          toggleNotFoundMsg(true);
          break;
        }
      }
    }
    
    let bkmks = await gCmd.getBookmarks();
    await rebuildReadingList(bkmks, aFilter == this.UNREAD);

    if (bkmks.length == 0) {
      toggleSearchBar(false);
      toggleEmptyMsg(true);
    }
    else {
      if (aFilter == this.UNREAD && isReadingListEmpty() && !isNotFoundMsgVisible()) {
        toggleNoUnreadMsg(true);
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
  _numMatches: null,

  init()
  {
    if (this._isInitialized) {
      return;
    }
    
    $("#search-box").prop("placeholder", browser.i18n.getMessage("srchBoxHint"))
      .focus(aEvent => {
        $("#search-box-ctr").addClass("focus");
      })
      .blur(aEvent => {
        $("#search-box-ctr").removeClass("focus");
      })
      .keyup(aEvent => {
        if (aEvent.key == "Tab" && aEvent.shiftKey) {
          return;
        }
        if (["Tab", "Shift", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
             "Home", "End", "PageUp", "PageDown", "Insert", "ContextMenu",
             "Enter", "Alt", "Control", "Meta", "AltGraph", "Fn", "Help",
             "CapsLock", "NumLock", "ScrollLock", "PrintScreen", "Eject",
             "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10",
             "F11", "F12", "F13", "F14", "F15", "F16", "F17", "F18", "F19",
            ].includes(aEvent.key)) {
          return;
        }
        if (aEvent.key == "Escape" || aEvent.key == "Clear") {
          this.reset();
        }
        else {
          this.updateSearch();
          $("#clear-search").css({
            visibility: (aEvent.target.value ? "visible" : "hidden")
          });
        }
      });

    $("#clear-search").on("click", aEvent => { this.reset() });

    this._isInitialized = true;
  },

  getSearchText()
  {
    return $("#search-box").val();
  },

  isSearchInProgress()
  {
    return (this.getSearchText() != "");
  },

  show()
  {
    $("#search-bar").show();
  },

  hide()
  {
    $("#search-bar").hide();
  },

  enable()
  {
    $("#search-box").prop("disabled", false);
  },

  disable()
  {
    $("#search-box").prop("disabled", true);
  },

  async updateSearch()
  {
    let srchResults = await browser.runtime.sendMessage({
      id: "search-bookmarks",
      searchTerms: $("#search-box").val(),
    });

    let unreadOnly = gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD;
    if (unreadOnly) {
      srchResults = srchResults.filter(aItem => aItem.unread);
    }
    this._numMatches = srchResults.length;

    if (srchResults.length == 0) {
      clearReadingList();
      toggleEmptyMsg(false);
      toggleNoUnreadMsg(false);
      toggleNotFoundMsg(true);
      return;
    }
    
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

  async reset()
  {
    $("#search-box").val("").focus();
    $("#clear-search").css({visibility: "hidden"});
    this._numMatches = null;
    toggleNotFoundMsg(false);

    let bkmks = await gCmd.getBookmarks();
    if (bkmks.length == 0) {
      toggleSearchBar(false);
      clearReadingList();
      toggleEmptyMsg(true);
      return;
    }

    let unreadOnly = gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD;
    if (unreadOnly) {
      let unreadBkmks = bkmks.filter(aBkmk => aBkmk.unread);
      if (unreadBkmks.length == 0) {
        toggleNoUnreadMsg(true);
        return;
      }
    }
    
    rebuildReadingList(bkmks, unreadOnly);
  }
};


// Sidebar initialization
$(async () => {
  let {os} = await browser.runtime.getPlatformInfo();
  gOS = document.body.dataset.os = os;
  aeVisual.init(os);

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

  $("#toolbar")[0].ariaLabel = browser.i18n.getMessage("lblTbar");
  $("#search-bar")[0].ariaLabel = browser.i18n.getMessage("lblSrchBar");

  // Preload toolbar button and message box icons.
  aeVisual.preloadLafImages();
  aeVisual.preloadMsgBoxIcons();
  aeVisual.cacheIcons(
    "add-link-hover.svg",
    "add-link-dk.svg"
  );

  if (gPrefs.defDlgBtnFollowsFocus) {
    aeInterxn.initDialogButtonFocusHandlers();
  }
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
      toggleEmptyMsg(true);
      toggleSearchBar(false);
    }
    else {
      hideLoadingProgress();
      toggleEmptyMsg(false);
      await buildReadingList(bkmks, false);
    }
  }
}


async function buildReadingList(aBookmarks, aUnreadOnly)
{
  log(`Read Next: ${aBookmarks.length} items.`);
  log(aBookmarks);

  if (aBookmarks.length == 0) {
    toggleSearchBar(false);
    return;
  }
  else {
    toggleSearchBar(true);
    enableReadingListKeyboardNavigation();
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
      toggleNotFoundMsg(false);
    }
    else {
      return;
    }
  }

  toggleEmptyMsg(false);
  toggleNoUnreadMsg(false);
  hideLoadingProgress();
  toggleSearchBar(true);
  
  let tooltipText = `${aBookmark.title}\n${aBookmark.url}`;
  let listItemDiv = $("<div>").addClass("reading-list-item").attr("title", tooltipText)[0];
  listItemDiv.id = `bkmk-${aBookmark.id}`;
  listItemDiv.dataset.id = aBookmark.id;
  listItemDiv.dataset.title = aBookmark.title;
  listItemDiv.dataset.url = aBookmark.url;
  listItemDiv.dataset.unread = aBookmark.unread;
  listItemDiv.setAttribute("role", "option");
  listItemDiv.setAttribute("aria-selected", "false");

  if (aBookmark.unread) {
    let cls = gPrefs.boldUnreadBkmks ? "unread" : "unread-no-fmt"
    listItemDiv.classList.add(cls);
  }

  let favIconCanvas = $("<canvas>").addClass("favicon").css({width: "16px", height: "16px"})[0];
  let scale = window.devicePixelRatio;
  favIconCanvas.width = Math.floor(16 * scale);
  favIconCanvas.height = Math.floor(16 * scale);
  favIconCanvas.setAttribute("role", "presentation");
  
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
  listItemTitle.attr("role", "presentation");
  let listItem = $(listItemDiv);
  listItem.append(favIconCanvas);
  listItem.append(listItemTitle);
  $("#reading-list").append(listItem);

  if (isReadingListKeyboardNavDisabled()) {
    enableReadingListKeyboardNavigation();
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
          toggleEmptyMsg(true);
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
          $("#reading-list").children().removeClass("focused").attr("aria-selected", "false");
        }
        let item = $("#reading-list").children().get(gKeybSelectedIdx);
        item.classList.add("focused");
        item.ariaSelected = "true";
        $("#reading-list").attr("aria-activedescendant", item.id);
      }
    }
  });
}


function updateReadingListItem(aBookmark)
{
  let bkmkElt = $(`.reading-list-item[data-id="${aBookmark.id}"]`);
  let tooltipText = `${aBookmark.title}\n${aBookmark.url}`;
  bkmkElt.attr("title", tooltipText).attr("data-title", aBookmark.title);
  bkmkElt.find(".reading-list-item-title").text(aBookmark.title);
}


async function rebuildReadingList(aBookmarks, aUnreadOnly, aReloadFavIcons=false)
{
  toggleEmptyMsg(false);
  toggleNoUnreadMsg(false);
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


async function markAsRead(aBookmarkID, aIsRead)
{
  let listItem = $(`#reading-list > .reading-list-item[data-id="${aBookmarkID}"]`);
  let cls = gPrefs.boldUnreadBkmks ? "unread" : "unread-no-fmt"

  if (aIsRead) {
    listItem.removeClass(cls);
    listItem.attr("data-unread", false);

    if (gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD
        && gPrefs.autoUpdateUnreadFilter) {
      listItem.fadeOut(200, async () => {
        let numUnreadItems = $("#reading-list").children().filter(":visible").length;
        if (numUnreadItems == 0) {
          if (gSearchBox.isSearchInProgress()) {
            // If none of the unread items match the search terms, show 
            // "No items found" which is more accurate than "No unread items"
            let bkmks = await gCmd.getBookmarks();
            let unreadItems = bkmks.filter(aItem => aItem.unread);
            if (unreadItems.length == 0) {
              toggleNoUnreadMsg(true);
            }
            else {
              toggleNotFoundMsg(true);
            }
          }
          else {
            toggleNoUnreadMsg(true);
          }
        }
      });
    }
  }
  else {
    // Item was marked as unread.
    let selectedFilter = gReadingListFilter.getSelectedFilter();
    if (selectedFilter == gReadingListFilter.UNREAD && gPrefs.autoUpdateUnreadFilter) {
      toggleNoUnreadMsg(false);
      toggleNotFoundMsg(false);

      let bkmks = await gCmd.getBookmarks();
      await rebuildReadingList(bkmks, selectedFilter == gReadingListFilter.UNREAD);

      if (gSearchBox.isSearchInProgress()) {
        gSearchBox.updateSearch();
      }
    }
    else {
      listItem.addClass(cls);
      listItem.attr("data-unread", true);
    }
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
  let lang = browser.i18n.getUILanguage();
  let btnLabel = browser.i18n.getMessage("addLink");

  if (["de"].includes(lang)) {
    // For locales where the button label is too long, show tooltip instead.
    $("#add-link").attr("title", btnLabel)
  }
  else {
    $("#add-link").text(btnLabel);
  }
  
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
  gRenameDlg.onShow = function ()
  {
    // Vertically position dialog to be as close as possible to the
    // selected reading list link.
    let selectedBkmk = $(`.reading-list-item[data-id="${this.bkmkID}"]`)[0];
    let cntRect = $("#scroll-content")[0].getBoundingClientRect();
    let bkmkRect = selectedBkmk.getBoundingClientRect();
    let {height} = this._dlgElt[0].getBoundingClientRect();
    let cntTopThird = cntRect.top + Math.floor(cntRect.height / 3);
    let cntBotThird = cntRect.bottom - Math.ceil(cntRect.height / 3);
    let bkmkTop = Math.ceil(bkmkRect.top);

    if (bkmkTop >= cntTopThird && bkmkTop < cntBotThird) {
      this._dlgElt.css({top: `${Math.ceil((cntRect.height - height) / 2)}px`});
    }
    else if (bkmkTop >= cntBotThird) {
      this._dlgElt.css({top: `${Math.floor(cntBotThird) - 64}px`});
    }
    else {
      this._dlgElt.css({top: "88px"});
    }

    browser.runtime.sendMessage({id: "start-edit-bookmark"});
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
  gRenameDlg.onUnload = function ()
  {
    browser.runtime.sendMessage({id: "stop-edit-bookmark"});
  };

  gRenameOtherWndMsgBox = new aeDialog("#rename-other-wnd-msgbox");
  gRenameOtherWndMsgBox.setProps({
    renameDlgSrcWndID: null,
  });
  gRenameOtherWndMsgBox.setOtherWndID = function (aWndID)
  {
    this.renameDlgSrcWndID = aWndID;
  };
  gRenameOtherWndMsgBox.onFirstInit = function ()
  {
    this.find("#switch-wnd-btn").on("click", async (aEvent) => {
      if (!this.renameDlgSrcWndID) {
        throw new ReferenceError("Read Next::sidebar.js: gRenameOtherWndMsgBox: renameDlgSrcWndID not initialized");
      }

      let wnd;
      try {
        wnd = await browser.windows.get(this.renameDlgSrcWndID);
      }
      catch {}

      if (!wnd) {
        // Browser window was closed before renaming the link was finished.
        this.close();
        return;
      }

      browser.windows.update(this.renameDlgSrcWndID, {focused: true});
      this.close();
    });
  };
  gRenameOtherWndMsgBox.onUnload = function ()
  {
    this.renameDlgSrcWndID = null;
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

  gKeybdCxtMenu = new aeDialog("#keybd-cxt-menu");
  gKeybdCxtMenu.setProps({
    _focusedIdx: null,
    _lastFocusedBtn: null,
    selectedBkmk: null,
  });
  
  gKeybdCxtMenu.onFirstInit = function ()
  {
    $("#cmd-open").on("click", aEvent => {
      this.close();
      gCmd.open(this.selectedBkmk.dataset.id, this.selectedBkmk.dataset.url);
      gPrefs.closeSidebarAfterNav && browser.sidebarAction.close();
    });
    $("#cmd-open-new-tab").on("click", aEvent => {
      this.close();
      gCmd.openInNewTab(this.selectedBkmk.dataset.id, this.selectedBkmk.dataset.url);
      gPrefs.closeSidebarAfterNav && browser.sidebarAction.close();
    });
    $("#cmd-open-new-wnd").on("click", aEvent => {
      this.close();      
      gCmd.openInNewWnd(this.selectedBkmk.dataset.id, this.selectedBkmk.dataset.url);
      gPrefs.closeSidebarAfterNav && browser.sidebarAction.close();
    });
    $("#cmd-open-new-prv-wnd").on("click", aEvent => {
      this.close();
      gCmd.openInNewPrivateWnd(this.selectedBkmk.dataset.id, this.selectedBkmk.dataset.url);
      gPrefs.closeSidebarAfterNav && browser.sidebarAction.close();
    });
    $("#cmd-mark-unread").on("click", async (aEvent) => {
      this.close();
      let unread = this.selectedBkmk.dataset.unread == "true";
      await gCmd.markAsRead(this.selectedBkmk.dataset.id, unread);
    });
    $("#cmd-rename").on("click", aEvent => {
      this.close();
      gCmd.rename(this.selectedBkmk.dataset.id);
    });
    $("#cmd-delete").on("click", async (aEvent) => {
      let bkmkID = this.selectedBkmk.dataset.id;
      try {
        await gCmd.deleteBookmark(bkmkID);
      }
      catch (e) {
        warn("Read Next: Error removing bookmark: " + e);
      }
      this.close();
    });
    $("#cmd-sync").on("click", aEvent => {
      this.close();
      gCmd.syncBookmarks(true);      
    });
    $("#cmd-show-all").on("click", aEvent => {
      this.close();
      $("#filter-all").click();
      $("#cmd-show-unread").removeClass("context-menu-icon-checked");
      $("#cmd-show-all").addClass("context-menu-icon-checked");
    });
    $("#cmd-show-unread").on("click", aEvent => {
      this.close();
      $("#filter-unread").click();
      $("#cmd-show-all").removeClass("context-menu-icon-checked");
      $("#cmd-show-unread").addClass("context-menu-icon-checked");
    });
    $("#cmd-customize").on("click", aEvent => {
      this.close();
      gCustomizeDlg.showModal();
    });

    this._dlgElt.on("mouseenter", aEvent => {
      let focusedBtn = this._dlgElt.find("button:focus");
      if (!focusedBtn) {
        warn("Read Next::sidebar.js: Nothing focused in the keyboard-activated context menu");
        return;
      }
      
      focusedBtn.blur();
      this._lastFocusedBtn = focusedBtn;

    }).on("mouseleave", aEvent => {
      let {top, bottom} = this._dlgElt[0].getBoundingClientRect();
      let btns = this._dlgElt.find("button:visible");
      let btnRects = [];
      for (let btn of btns) {
        btnRects.push(btn.getBoundingClientRect());
      }

      // Hovered over first item in context menu
      if (aEvent.clientY >= top - 8 && aEvent.clientY <= top + 32) {
        let firstBtn = btns.get(0);
        firstBtn.focus();
        this._focusedIdx = 0;
      }
      // Hovered over last item in context menu
      else if (aEvent.clientY >= bottom - 32 && aEvent.clientY <= bottom + 8) {
        let lastBtn = btns.get(btns.length - 1);
        lastBtn.focus();
        this._focusedIdx = btns.length - 1;
      }
      // Hovered over items in between first and last
      else {
        let selected = false;
        for (let i = 0; i < btnRects.length; i++) {
          let btnRect = btnRects[i];
          if (aEvent.clientY >= btnRect.top && aEvent.clientY <= btnRect.bottom) {
            btns.get(i).focus();
            this._focusedIdx = i;
            selected = true;
            break;
          }
        }

        if (!selected) {
          // Hovered over separator or other whitespace in the context menu.
          // In this case, don't focus anything.
          this._focusedIdx = null;
          this._lastFocusedBtn?.blur();
        }
      }

    }).on("keydown", aEvent => {
      let focusedBtn = this._dlgElt.find("button:focus");
      if (!focusedBtn) {
        warn("Read Next::sidebar.js: Nothing focused in the keyboard-activated context menu");
        return;
      }

      let btns = this._dlgElt.find("button:visible");
      
      if (aEvent.key == "ArrowDown") {
        if (btns.index(focusedBtn) == btns.length - 1) {
          let firstBtn = btns.get(0);
          firstBtn.focus();
          this._focusedIdx = 0;
        }
        else {
          let nextBtn = btns.get(++this._focusedIdx);
          nextBtn.focus();
        }
      }
      else if (aEvent.key == "ArrowUp") {
        if (btns.index(focusedBtn) == 0) {
          this._focusedIdx = btns.length - 1;
          let lastBtn = btns.get(this._focusedIdx);
          lastBtn.focus();
        }
        else {
          let prevBtn = btns.get(--this._focusedIdx);
          prevBtn.focus();
        }
      }
    });
  };

  gKeybdCxtMenu.onInit = function ()
  {
    // Show or hide menu items
    if (gPrefs.linkClickAction == aeConst.OPEN_LINK_IN_NEW_TAB) {
      $("#cmd-open").show();
    }
    else {
      $("#cmd-open").hide();
    }

    if (initContextMenu.showOpenInPrivBrws) {
      $("#cmd-open-new-prv-wnd").show();
    }
    else {
      $("#cmd-open-new-prv-wnd").hide();
    }

    if (initContextMenu.showManualSync) {
      $("#cmd-sync, #cmd-sync-sep").show();
    }
    else {
      $("#cmd-sync, #cmd-sync-sep").hide();
    }

    // Mark as read/unread menu item
    let unread = this.selectedBkmk.dataset.unread == "true";
    let unreadLabel;
    if (unread) {
      unreadLabel = browser.i18n.getMessage("mnuMrkRead");
    }
    else {
      unreadLabel = browser.i18n.getMessage("mnuMrkUnread");
    }
    $("#cmd-mark-unread").text(unreadLabel);

    // Initial checked item
    if (gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD) {
      $("#cmd-show-all").removeClass("context-menu-icon-checked");
      $("#cmd-show-unread").addClass("context-menu-icon-checked");
    }
    else {
      $("#cmd-show-all").addClass("context-menu-icon-checked");
      $("#cmd-show-unread").removeClass("context-menu-icon-checked");
    }
  };

  gKeybdCxtMenu.onShow = function ()
  {
    $("#lightbox-bkgrd-ovl").addClass("keyb-cxt-mnu-ovl").on("click.keybCxtMnu", aEvent => {
      this.close();
    });

    let firstBtn = this._dlgElt.find("button:visible").first();
    firstBtn[0].focus();
    this._focusedIdx = 0;

    // Vertically position context menu to be as close as possible to
    // the selected reading list link.
    let cntRect = $("#scroll-content")[0].getBoundingClientRect();
    let bkmkRect = this.selectedBkmk.getBoundingClientRect();
    let {height} = this._dlgElt[0].getBoundingClientRect();
    let cntTopThird = cntRect.top + Math.floor(cntRect.height / 3);
    let cntBotThird = cntRect.bottom - Math.ceil(cntRect.height / 3);
    let bkmkTop = Math.ceil(bkmkRect.top);

    if (bkmkTop >= cntTopThird && bkmkTop < cntBotThird) {
      this._dlgElt.css({top: `${Math.ceil((cntRect.height - height) / 2)}px`});
    }
    else if (bkmkTop >= cntBotThird) {
      this._dlgElt.css({top: `${Math.floor(cntRect.bottom) - height - 8}px`});
    }
    else {
      this._dlgElt.css({top: "100px"});
    }
  };

  gKeybdCxtMenu.onUnload = function ()
  {
    $("#lightbox-bkgrd-ovl").removeClass("keyb-cxt-mnu-ovl").off("click.keybCxtMnu");
    this._focusedIdx = null;
  };
}


function initContextMenu()
{
  // Empty content area in the sidebar
  $.contextMenu({
    selector: "#scroll-content:not(:has(.welcome-banner))",
    className: "default-cxt-menu",

    events: {
      activated(aOptions)
      {
        let mnu = aOptions.$menu;
        mnu[0].focus();
      },

      show(aOptions)
      {
        // Prevent this context menu from appearing when SHIFT+F10 is pressed.
        if (whatInput.ask() == "keyboard") {
          return false;
        }
        return true;
      }
    },

    items: {
      showAllLinks: {
        name: browser.i18n.getMessage("cxtMnuFltrAll"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          $("#filter-all").click();
        },
        icon(aOpt, aItemElement, aItemKey, aItem) {
          aItemElement.removeClass("context-menu-icon-checked")
          if (gReadingListFilter.getSelectedFilter() == gReadingListFilter.ALL) {
            return "context-menu-icon-checked";
          }
        },
      },
      showUnreadLinks: {
        name: browser.i18n.getMessage("cxtMnuFltrUnread"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          $("#filter-unread").click();
        },
        icon(aOpt, aItemElement, aItemKey, aItem) {
          aItemElement.removeClass("context-menu-icon-checked")
          if (gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD) {
            return "context-menu-icon-checked";
          }
        },
      },
      separator: "---",
      customize: {
        name: browser.i18n.getMessage("mnuCustz"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          gCustomizeDlg.showModal();
        }
      }
    }
  });

  // Individual reading list item
  $.contextMenu({
    selector: ".reading-list-item",
    className: "reading-list-cxt-menu",

    events: {
      activated(aOptions)
      {
        let mnu = aOptions.$menu;
        mnu[0].focus();
      }
    },

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
      filterSep: "---",
      showAllLinks: {
        name: browser.i18n.getMessage("cxtMnuFltrAll"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          $("#filter-all").click();
        },
        icon(aOpt, aItemElement, aItemKey, aItem) {
          aItemElement.removeClass("context-menu-icon-checked")
          if (gReadingListFilter.getSelectedFilter() == gReadingListFilter.ALL) {
            return "context-menu-icon-checked";
          }
        },
      },
      showUnreadLinks: {
        name: browser.i18n.getMessage("cxtMnuFltrUnread"),
        className: "ae-menuitem",
        callback(aKey, aOpt) {
          $("#filter-unread").click();
        },
        icon(aOpt, aItemElement, aItemKey, aItem) {
          aItemElement.removeClass("context-menu-icon-checked")
          if (gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD) {
            return "context-menu-icon-checked";
          }
        },
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

  aeInterxn.initContextMenuAriaRoles(".default-cxt-menu");
  aeInterxn.initContextMenuAriaRoles(".reading-list-cxt-menu");
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


function toggleEmptyMsg(aIsVisible)
{
  if (aIsVisible) {
    if (gPrefs.syncEnabled) {
      $("#sync-cta").hide();
    }
    else {
      $("#sync-cta").show();
    }

    $("#welcome").addClass("welcome-banner").show();    
  }
  else {
    $("#welcome").removeClass("welcome-banner").hide();
  }
}


function isEmptyMsgVisible()
{
  return $("#welcome").is(":visible");
}


function toggleNoUnreadMsg(aIsVisible)
{
  if (aIsVisible) {
    $("#no-unread").show();
  }
  else {
    $("#no-unread").hide();
  }
}


function toggleNotFoundMsg(aIsVisible)
{
  if (aIsVisible) {
    $("#not-found").show();
  }
  else {
    $("#not-found").hide();
  }
}


function isNotFoundMsgVisible()
{
  return $("#not-found").is(":visible");
}


function showLoadingProgress()
{
  if (isEmptyMsgVisible()) {
    toggleEmptyMsg(false);
  }
  gSearchBox.disable();
  $("#loading").show();
}


function hideLoadingProgress()
{
  $("#loading").hide();
  gSearchBox.enable();
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


function toggleSearchBar(aIsVisible)
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


function enableReadingListKeyboardNavigation()
{
  function isHomeKeyPressed(aKeybEvent)
  {
    let rv = false;

    if (aKeybEvent.key == "Home") {
      rv = true;
    }
    else {
      if (gOS == "mac") {
        rv = (aKeybEvent.key == "ArrowUp" && aKeybEvent.metaKey);
      }
      else {
        rv = (aKeybEvent.key == "ArrowUp" && aKeybEvent.ctrlKey);
      }
    }
    return rv;
  }

  function isEndKeyPressed(aKeybEvent)
  {
    let rv = false;

    if (aKeybEvent.key == "End") {
      rv = true;
    }
    else {
      if (gOS == "mac") {
        rv = (aKeybEvent.key == "ArrowDown" && aKeybEvent.metaKey);
      }
      else {
        rv = (aKeybEvent.key == "ArrowDown" && aKeybEvent.ctrlKey);
      }
    }
    return rv;
  }
 
  function isPageUpKeyPressed(aKeybEvent)
  {
    let rv = (aKeybEvent.key == "PageUp"
              || (aKeybEvent.key == " " && aKeybEvent.shiftKey));  // Shift+Spacebar
    return rv;
  }

  function isPageDownKeyPressed(aKeybEvent)
  {
    let rv = (aKeybEvent.key == "PageDown"
              || (aKeybEvent.key == " " && !aKeybEvent.shiftKey)); // Spacebar
    return rv;
  }
  // END nested functions

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

    let rdgListItems = $("#reading-list").children();
    let numItems = rdgListItems.length;
    let {contentHeight, contentTop} = getScrollableContentGeometry();
    
    if (aEvent.key == "ArrowDown" || isEndKeyPressed(aEvent)) {
      if (gKeybSelectedIdx === null) {
        gKeybSelectedIdx = 0;
      }
      else if (gKeybSelectedIdx == numItems - 1) {
        warn("Read Next::sidebar.js: Reached the end of the reading list.");
      }
      else {
        let item = rdgListItems.get(gKeybSelectedIdx);
        item.classList.remove("focused");
        item.ariaSelected = "false";

        if (isEndKeyPressed(aEvent)) {
          gKeybSelectedIdx = rdgListItems.length - 1;
        }
        else {
          gKeybSelectedIdx++;
        }
      }

      let item = $("#reading-list").children().get(gKeybSelectedIdx);
      item.classList.add("focused");
      item.ariaSelected = "true";
      $("#reading-list").attr("aria-activedescendant", item.id);

      let {top} = item.getBoundingClientRect();
      if (top > contentHeight) {
        item.scrollIntoView({block: "end", behavior: "instant"});
      }
      
      aEvent.preventDefault();
    }
    else if (aEvent.key == "ArrowUp" || isHomeKeyPressed(aEvent)) {
      if (! gKeybSelectedIdx) {
        warn("Read Next::sidebar.js: Reached the start of the reading list.");
      }
      else {
        let item = rdgListItems.get(gKeybSelectedIdx);
        item.classList.remove("focused");
        item.ariaSelected = "false";

        if (isHomeKeyPressed(aEvent)) {
          gKeybSelectedIdx = 0;
        }
        else {
          gKeybSelectedIdx--;
        }
      }

      let item = $("#reading-list").children().get(gKeybSelectedIdx);
      item.classList.add("focused");
      item.ariaSelected = "true";
      $("#reading-list").attr("aria-activedescendant", item.id);

      let {top} = item.getBoundingClientRect();
      if (top < contentTop) {
        item.scrollIntoView({block: "start", behavior: "instant"});
      }

      aEvent.preventDefault();
    }
    if (isPageDownKeyPressed(aEvent)) {
      if (gKeybSelectedIdx === null) {
        gKeybSelectedIdx = 0;
        let item = rdgListItems.get(0);
        item.classList.add("focused");
        item.ariaSelected = "true";
        $("#reading-list").attr("aria-activedescendant", item.id);
      }
      else if (gKeybSelectedIdx == numItems - 1) {
        warn("Read Next::sidebar.js: Reached the end of the reading list.");
      }
      else {
        // Scroll the currently-selected item to top before starting calculation
        // of pagination length from the next set of variable-height items.
        let currItem = rdgListItems.get(gKeybSelectedIdx);
        currItem.scrollIntoView({block: "start", behavior: "instant"});
        currItem.classList.remove("focused");
        currItem.ariaSelected = "false";

        let nextIdx = gKeybSelectedIdx;
        let isLastInMiddle = false;
        let item;
        let currTop;

        do {
          if (nextIdx++ == numItems - 1) {
            isLastInMiddle = true;
          }

          if (!isLastInMiddle) {
            item = rdgListItems.get(nextIdx);
            currTop = item.getBoundingClientRect().top;
            gKeybSelectedIdx = nextIdx;
          }

          if (isLastInMiddle || currTop >= contentHeight) {
            item.classList.add("focused");
            item.ariaSelected = "true";
            item.scrollIntoView({block: "end", behavior: "instant"});
            $("#reading-list").attr("aria-activedescendant", item.id);
          }
        } while (!isLastInMiddle && currTop < contentHeight);
      }
      aEvent.preventDefault();
    }
    else if (isPageUpKeyPressed(aEvent)) {
      if (! gKeybSelectedIdx) {
        warn("Read Next::sidebar.js: Reached the start of the reading list.");
      }
      else {
        // Scroll currently-selected item to bottom first.
        let currItem = rdgListItems.get(gKeybSelectedIdx);
        currItem.scrollIntoView({block: "end", behavior: "instant"});
        currItem.classList.remove("focused");
        currItem.ariaSelected = "false";

        let prevIdx = gKeybSelectedIdx;
        let isAtTop = false;
        let item;
        let currTop;

        do {
          if (prevIdx-- == 0) {
            isAtTop = true;
          }

          if (!isAtTop) {
            item = rdgListItems.get(prevIdx);
            currTop = item.getBoundingClientRect().top;
            gKeybSelectedIdx = prevIdx;
          }

          if (isAtTop || currTop <= contentTop) {
            item.classList.add("focused");
            item.ariaSelected = "true";
            item.scrollIntoView({block: "start", behavior: "instant"});
            $("#reading-list").attr("aria-activedescendant", item.id);
          }
        } while (!isAtTop && currTop > contentTop);
      }
      aEvent.preventDefault();
    }
    else if (aEvent.key == "Enter") {
      let item = $("#reading-list").children().get(gKeybSelectedIdx);
      gCmd.open(item.dataset.id, item.dataset.url);

      aEvent.preventDefault();
    }
  });
}


function disableReadingListKeyboardNav()
{
  $("#reading-list").removeAttr("tabindex").off("keydown.readingList");
  gKeybSelectedIdx = null;
}


function isReadingListKeyboardNavDisabled()
{
  return ($("#reading-list").attr("tabindex") === undefined);
}


function getScrollableContentGeometry()
{
  let rv = {};
  let contentElt = $("#scroll-content")[0];
  let rect = contentElt.getBoundingClientRect();
  let style = window.getComputedStyle(contentElt);

  rv.contentHeight = parseInt(style.height);
  rv.contentTop = rect.top;

  return rv;
}


function makeLastItemVisible(aHighlightItem=false)
{
  let rdgListItems = $("#reading-list").children();
  let lastItem = rdgListItems.get(rdgListItems.length - 1);
  let {contentHeight} = getScrollableContentGeometry();
  let {top} = lastItem.getBoundingClientRect();

  if (top >= contentHeight) {
    lastItem.scrollIntoView({block: "end", behavior: "smooth"});
  }

  if (aHighlightItem) {
    lastItem.classList.add("transient-highlight");

    setTimeout(() => {
      lastItem.classList.remove("transient-highlight");
    }, 6000);
  }
}


//
// Event handlers
//

browser.runtime.onMessage.addListener(aMessage => {
  log(`Read Next::sidebar.js: Window ID ${gWndID} received extension message "${aMessage.id}"`);

  let resp = null;

  switch (aMessage.id) {
  case "bookmark-added":
    addReadingListItem(aMessage.bookmark).then(() => {
      return aePrefs.getPref("highlightNewLink");
    }).then(aHighlightNewLink => {
      // New items are always added to the end.
      makeLastItemVisible(aHighlightNewLink);
      return browser.tabs.query({active: true, currentWindow: true});
    }).then(aTabs => {
      let actvTab = aTabs[0];
      if (aMessage.bookmark.url == actvTab.url) {
        $("#add-link, #add-link-cta").prop("disabled", true);
      }
    });
    break;

  case "bookmark-removed":
    removeReadingListItem(aMessage.bookmark.id);
    browser.tabs.query({active: true, currentWindow: true}).then(aTabs => {
      let actvTab = aTabs[0];
      if (aMessage.bookmark.url == actvTab.url) {
        $("#add-link, #add-link-cta").prop("disabled", false);
      }
    });
    break;

  case "bookmark-renamed":
    updateReadingListItem(aMessage.bookmark);
    break;

  case "cancel-rename-bookmark":
    gCmd.cancelRename();
    resp = true;
    break;

  case "bookmarks-reloaded":
    if ($("#reauthz-msgbar").is(":visible")) {
      hideMessageBar("#reauthz-msgbar");
    }
    if ($("#neterr-msgbar").is(":visible")) {
      hideMessageBar("#neterr-msgbar");
    }
    hideLoadingProgress();

    if (aMessage.bookmarks.length == 0) {
      toggleSearchBar(false);
      if (gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD) {
        gSearchBox.reset();
      }
      else {
        if (!gSearchBox.isSearchInProgress()) {
          gSearchBox.reset();
        }
      }
      toggleEmptyMsg(true);
      break;
    }

    let unreadOnly = gReadingListFilter.getSelectedFilter() == gReadingListFilter.UNREAD;
    rebuildReadingList(aMessage.bookmarks, unreadOnly);
    break;

  case "favicon-saved":
    gFavIconMap.set(aMessage.bookmarkID, aMessage.iconData);
    // The favicon map is populated before a new bookmark is added, so check
    // that the bookmark exists.
    if (readingListItemExists(aMessage.bookmarkID)) {
      updateFavIcon(aMessage.bookmarkID, aMessage.iconData);
    }
    break;

  case "marked-as-read":
    markAsRead(aMessage.bookmarkID, aMessage.isRead);
    break;

  case "tab-loading-finished":
  case "tab-activated":
    browser.windows.getCurrent().then(aCurrWnd => {
      if (aCurrWnd.id == aMessage.windowID) {
        $("#add-link, #add-link-cta").prop("disabled", (aMessage.bkmkExists || !aMessage.isSupportedURL));
      }
    });
    break;

  case "sync-setting-changed":
    if (aMessage.syncEnabled) {
      toggleEmptyMsg(false);
      toggleNoUnreadMsg(false);
      toggleNotFoundMsg(false);
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

      gCmd.cancelRename();
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

  case "whats-new-pg-opened":
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
  if (!gPrefs) {
    // Event handler was called before the UI is initialized.
    return;
  }

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
 
  toggleEmptyMsg(false);
  toggleNoUnreadMsg(false);

  if (gPrefs.closeTabAfterAdd) {
    gCmd.closeTab(actvTab.id);
  }
});


$("#setup-sync").on("click", async (aEvent) => {
  let extPrefsPg;
  try {
    extPrefsPg = await browser.runtime.sendMessage({id: "ping-ext-prefs-pg"});
  }
  catch {}

  if (extPrefsPg) {
    browser.tabs.update(extPrefsPg.tabID, {active: true});
    browser.runtime.sendMessage({id: "open-connection-wiz"});
  }
  else {
    await browser.runtime.sendMessage({id: "enable-auto-open-connect-wiz"});
    browser.runtime.openOptionsPage();
  }
});


$("#reading-list").on("click", aEvent => {
  let item;
  if (aEvent.target.className == "reading-list-item-title"
      || aEvent.target.className == "favicon") {
    item = aEvent.target.parentNode;
  }
  else if (aEvent.target.classList.contains("reading-list-item")) {
    item = aEvent.target;
  }

  gKeybSelectedIdx === null && (gKeybSelectedIdx = 0);

  let rdgListItems = $("#reading-list").children();
  let prevSelectedItem = rdgListItems.get(gKeybSelectedIdx);
  prevSelectedItem.classList.remove("focused");
  prevSelectedItem.ariaSelected = "false";
  gKeybSelectedIdx = $(item).index();

  if (gPrefs.linkClickAction == aeConst.OPEN_LINK_IN_NEW_TAB) {
    gCmd.openInNewTab(item.dataset.id, item.dataset.url);
  }
  else {
    // Default to opening in current tab.
    gCmd.open(item.dataset.id, item.dataset.url);
  }

  if (gPrefs.closeSidebarAfterNav) {
    browser.sidebarAction.close();
  }
});


$("#reading-list").on("focus", aEvent => {
  // Handling keyboard navigation change from scrolling the entire reading list
  // to selecting one individual item at a time.
  if (whatInput.ask() == "keyboard") {
    gKeybSelectedIdx === null && (gKeybSelectedIdx = 0);
    $("#reading-list").children().removeClass("focused").attr("aria-selected", "false");

    let {contentHeight, contentTop} = getScrollableContentGeometry();
    let rdgListItems = $("#reading-list").children();
    let item = rdgListItems.get(gKeybSelectedIdx);
    let {top} = item.getBoundingClientRect();
    let currTop = top;
    let nextIdx;

    if (top > contentHeight) {
      // Make sure that the focused item is also visible.
      // Select the last item that is visible at the bottom of the
      // scrollable view.
      nextIdx = gKeybSelectedIdx;
      while (currTop > contentHeight) {
        let prevItem = rdgListItems.get(nextIdx);
        let rect = prevItem.getBoundingClientRect();
        currTop = rect.top - rect.height;

        if (currTop <= contentHeight) {
          prevItem.classList.add("focused");
          prevItem.ariaSelected = "true";
          prevItem.scrollIntoView({block: "end", behavior: "instant"});
          $("#reading-list").attr("aria-activedescendant", prevItem.id);
          gKeybSelectedIdx = nextIdx;
        }
        else {
          nextIdx--;
        }
      }
    }
    else if (top < contentTop) {
      // Select the first element that is visible at the top of the
      // scrollable view.
      nextIdx = gKeybSelectedIdx + 1;
      while (currTop < contentTop) {
        let nextItem = rdgListItems.get(nextIdx);
        currTop = nextItem.getBoundingClientRect().top;

        if (currTop >= contentTop) {
          nextItem.classList.add("focused");
          nextItem.ariaSelected = "true";
          nextItem.scrollIntoView({block: "start", behavior: "instant"});
          $("#reading-list").attr("aria-activedescendant", nextItem.id);
          gKeybSelectedIdx = nextIdx;
        }
        else {
          nextIdx++;
        }
      }
    }
    else {
      item.classList.add("focused");
      item.ariaSelected = "true";
      $("#reading-list").attr("aria-activedescendant", item.id);
      gKeybSelectedIdx = $(item).index();
    }
  } 
});


$("#reading-list").on("blur", aEvent => {
  $("#reading-list").children().removeClass("focused").attr("aria-selected", "false");
});


$("#filter-all").on("click", handleFilterSelection)
  .on("focus", aEvent => { $('#bookmark-filter > input[type="radio"] ~ label').addClass("focused") })
  .on("blur", aEvent => { $('#bookmark-filter > input[type="radio"] ~ label').removeClass("focused") });


$("#filter-unread").on("click", handleFilterSelection)
  .on("focus", aEvent => { $('#bookmark-filter > input[type="radio"] ~ label').addClass("focused") })
  .on("blur", aEvent => { $('#bookmark-filter > input[type="radio"] ~ label').removeClass("focused") });


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


$(window).on("keydown", aEvent => {
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

    // The keyboard-activated context menu doesn't have OK or Cancel buttons.
    if (gKeybdCxtMenu.isOpen()) {
      gKeybdCxtMenu.close();
    }
  }
  else if (aEvent.key == "F10" && aEvent.shiftKey) {
    let focusedBkmk = $(".reading-list-item.focused");
    if (focusedBkmk.length == 1) {
      gKeybdCxtMenu.selectedBkmk = focusedBkmk[0];
      gKeybdCxtMenu.showModal();
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
