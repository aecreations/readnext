/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */


let gIsInitialized = false;
let gDialogs = {};


// Page initialization
$(async () => {
  let platform = await browser.runtime.getPlatformInfo();
  document.body.dataset.os = platform.os;

  if (platform.os == "win") {
    document.title = browser.i18n.getMessage("prefsTitleWin");
    $("#pref-hdg").text(browser.i18n.getMessage("prefsHdgWin"));
  }
  else {
    document.title = browser.i18n.getMessage("prefsTitle");
    $("#pref-hdg").text(browser.i18n.getMessage("prefsHdg"));
  }

  let lang = browser.i18n.getUILanguage();
  document.body.dataset.locale = lang;

  $("#close-tab-after-add-desc").html(sanitizeHTML(browser.i18n.getMessage("closeTabAfterAddDesc")));

  let prefs = await aePrefs.getAllPrefs();
  if (prefs.syncEnabled) {
    $("#sync-status-spinner").show();
  }
  showSyncStatus(prefs);

  if (! prefs.showPageAction) {
    $("#close-tab-after-add-desc").hide();
  }

  browser.runtime.sendMessage({
    id: "options-pg-status",
    isOpen: true,
  });

  $("#auto-delete-when-read").prop("checked", prefs.deleteReadLinks).on("click", aEvent => {
    aePrefs.setPrefs({deleteReadLinks: aEvent.target.checked});
  });

  $("#add-awesome-bar").prop("checked", prefs.showPageAction).on("click", async (aEvent) => {
    let showPageAction = aEvent.target.checked;
    if (showPageAction) {
      $("#close-tab-after-add-desc").show();
    }
    else {
      $("#close-tab-after-add-desc").hide();
    }

    await aePrefs.setPrefs({showPageAction});
    browser.runtime.sendMessage({
      id: "toggle-page-action",
      showPageAction,
    });
  });

  $("#add-cxt-menu").prop("checked", prefs.showCxtMenu).on("click", aEvent => {
    aePrefs.setPrefs({showCxtMenu: aEvent.target.checked});
  });

  $("#close-tab-after-add").prop("checked", prefs.closeTabAfterAdd).on("click", aEvent => {
    aePrefs.setPrefs({closeTabAfterAdd: aEvent.target.checked});
  });

  $("#auto-close-sidebar").prop("checked", prefs.closeSidebarAfterNav).on("click", aEvent => {
    aePrefs.setPrefs({closeSidebarAfterNav: aEvent.target.checked});
  });

  $("#open-in-curr-tab").prop("checked", prefs.linkClickAction == aeConst.OPEN_LINK_IN_CURRENT_TAB);
  $("#open-in-new-tab").prop("checked", prefs.linkClickAction == aeConst.OPEN_LINK_IN_NEW_TAB);

  $('input[type="radio"][name="open-links-in"]').on("click", aEvent => {
    aePrefs.setPrefs({linkClickAction: aEvent.target.value});
  });

  initDialogs();

  // Initialize static UI strings for user contribution CTA in the about dialog.
  let usrContribCTA = $("#usr-contrib-cta");
  usrContribCTA.append(sanitizeHTML(`<label id="usr-contrib-cta-hdg">${browser.i18n.getMessage("aboutContribHdg")}</label>&nbsp;&nbsp;`));
  usrContribCTA.append(sanitizeHTML(`<a href="${aeConst.DONATE_URL}" class="hyperlink">${browser.i18n.getMessage("aboutDonate")}</a>&nbsp;`));
  usrContribCTA.append(sanitizeHTML(`<label id="usr-contrib-cta-conj">${browser.i18n.getMessage("aboutContribConj")}</label>&nbsp;`));
  usrContribCTA.append(sanitizeHTML(`<a href="${aeConst.L10N_URL}" class="hyperlink">${browser.i18n.getMessage("aboutL10n")}</a>`));

  $(".hyperlink").on("click", aEvent => {
    aEvent.preventDefault();
    gotoURL(aEvent.target.href);
  });

  gIsInitialized = true;

  // Check if the cloud file host connection wizard should be opened automatically.
  let openConnectWiz = await browser.runtime.sendMessage({id: "should-open-connect-wiz"});
  if (openConnectWiz) {
    gDialogs.connectWiz.showModal();
  }
});


function initDialogs()
{
  gDialogs.connectWiz = new aeDialog("#connect-dlg");
  gDialogs.connectWiz.setProps({
    backnd: aeConst.FILEHOST_DROPBOX,
  });
  
  gDialogs.connectWiz.goToPage = function (aPageID)
  {
    this.find(".dlg-content > .wiz-page").hide();
    this.find(`.dlg-content > #${aPageID}`).show();

    let btnAccept = this.find(".dlg-btns > .dlg-accept");
    let btnCancel = this.find(".dlg-btns > .dlg-cancel");
    let {fileHostName} = aeFileHostUI(this.backnd);

    switch (aPageID) {
    case "authz-prologue":
      this.find(".dlg-btns > .dlg-accept").addClass("default");
      $("#authz-instr").text(browser.i18n.getMessage("wizAuthzInstr1", fileHostName));
      break;

    case "authz-progress":
      this.find(".dlg-btns > button").attr("disabled", "true");
      break;

    case "authz-success":
      $("#authz-succs-msg").text(browser.i18n.getMessage("wizAuthzSuccs", fileHostName));
      btnAccept.removeAttr("disabled").text(browser.i18n.getMessage("btnClose"));
      btnCancel.hide();
      this.changeKeyboardNavigableElts([btnAccept.get(0)]);
      break;

    case "authz-retry":
      $("#authz-interrupt").text(browser.i18n.getMessage("wizAuthzInterrupt", fileHostName));
      this.find(".dlg-btns > button").removeAttr("disabled");
      btnAccept.text(browser.i18n.getMessage("btnRetry"));
      break;

    case "authz-network-error":
      this.find(".dlg-btns > button").removeAttr("disabled");
      btnAccept.text(browser.i18n.getMessage("btnRetry"));
      break;

    default:
      break;
    }
  };

  gDialogs.connectWiz.getPageID = function ()
  {
    let rv;
    let pages = this.find(".dlg-content > .wiz-page").toArray();
    let page = pages.filter(aPage => $(aPage).css("display") == "block");

    if (page.length == 1) {
      rv = page[0].id;
    }
    return rv;
  };

  gDialogs.connectWiz.onInit = function ()
  {
    this.goToPage("authz-prologue");
  };

  gDialogs.connectWiz.onAccept = async function ()
  {
    let currPg = this.getPageID();

    switch (currPg) {
    case "authz-prologue":
    case "authz-retry":
    case "authz-network-error":
      this.goToPage("authz-progress");
      connectCloudFileSvc(this.backnd);
      break;

    case "authz-success":
      this.close();
      break;

    default:
      break;
    }    
  };

  gDialogs.connectWiz.onUnload = function ()
  {
    this.goToPage("authz-prologue");
    this.find(".dlg-btns > .dlg-accept").addClass("default").text(browser.i18n.getMessage("btnNext"));
    this.find(".dlg-btns > .dlg-cancel").removeAttr("disabled").show();
  };

  gDialogs.disconnectConfirm = new aeDialog("#disconnect-dlg");
  gDialogs.disconnectConfirm.onFirstInit = function ()
  {
    this.find(".dlg-btns > .dlg-btn-disconn").on("click", async (aEvent) => {
      let syncPrefs = {
        syncEnabled: false,
        syncBackend: null,
        accessToken: null,
        refreshToken: null,
        fileHostUsr: null,
      };

      try {
        await browser.runtime.sendMessage({id: "sync-disconnected-from-ext-prefs"});
      }
      catch {}

      await aePrefs.setPrefs(syncPrefs);
      try {
        await browser.runtime.sendMessage({
          id: "sync-setting-changed",
          syncEnabled: syncPrefs.syncEnabled,
        });
      }
      catch {}

      this.close();
      showSyncStatus(syncPrefs.syncEnabled);
      
      if ($("#retry-conn").is(":visible")) {
        $("#retry-conn").hide();
      }
      if ($("#reauthorize").is(":visible")) {
        $("#reauthorize").hide();
      }
    });
  };
  gDialogs.disconnectConfirm.onInit = async function ()
  {
    let syncBackend = await aePrefs.getPref("syncBackend");
    let {fileHostName} = aeFileHostUI(syncBackend);

    $("#disconnect-confirm").text(browser.i18n.getMessage("disconnTitle", fileHostName));
  };
  gDialogs.disconnectConfirm.focusedSelector = ".dlg-btns > .dlg-accept";

  gDialogs.about = new aeDialog("#about-dlg");
  gDialogs.about.setProps({
    extInfo: null,
  });
  gDialogs.about.onFirstInit = function ()
  {
    if (! this.extInfo) {
      let extManifest = browser.runtime.getManifest();
      this.extInfo = {
        name: extManifest.name,
        version: extManifest.version,
        description: extManifest.description,
        homePgURL: extManifest.homepage_url,
      };
    }
    
    $("#ext-name").text(this.extInfo.name);
    $("#ext-ver").text(browser.i18n.getMessage("aboutExtVer", this.extInfo.version));
    $("#ext-desc").text(this.extInfo.description);
    $("#ext-home-pg-link").attr("href", this.extInfo.homePgURL);
  };  
}


async function showSyncStatus(aPrefs)
{
  async function getFileHostUsr()
  {
    let rv = await browser.runtime.sendMessage({id: "get-username"});
    return rv;
  }
  // END nested function

  let toggleSyncBtn = $("#toggle-sync");

  if (aPrefs.syncEnabled) {
    let {fileHostName, iconPath} = aeFileHostUI(aPrefs.syncBackend);
    let fileHostUsr = aPrefs.fileHostUsr;

    // Always query the cloud file host for the user's account info to verify
    // the connection.
    try {
      fileHostUsr = await getFileHostUsr();
    }
    catch (e) {
      log("Read Next::options.js: showSyncStatus(): Error returned from inner helper function getFileHostUsr():\n" + e);
      
      $("#sync-icon").css({backgroundImage: ""}).addClass("conn-error");
      $("#sync-status").addClass("warning");

      // Need to check error type this way, because the error object type info
      // is lost when passed between extension pages via extension messaging.
      if (e.message.includes("NetworkError")) {  // TypeError
        $("#sync-status").text(browser.i18n.getMessage("errNoConnEx", fileHostName));
        $("#retry-conn").css({display: "inline"});
      }
      else if (e.message.includes("invalid_grant")) {  // aeAuthorizationError
        $("#sync-status").text(browser.i18n.getMessage("reauthzMsgBar", fileHostName));
        $("#reauthorize").css({display: "inline"});
      }
      
      toggleSyncBtn.text(browser.i18n.getMessage("btnDisconnect"));
      if (! toggleSyncBtn.is(":visible")) {
        toggleSyncBtn.css({display: "inline"});
      }
      return;
    }

    aePrefs.setPrefs({fileHostUsr});
    toggleSyncBtn.text(browser.i18n.getMessage("btnDisconnect"));
    if (! toggleSyncBtn.is(":visible")) {
      toggleSyncBtn.css({display: "inline"});
    }

    $("#sync-icon").removeClass();
    $("#sync-icon").css({backgroundImage: `url("${iconPath}")`});
    $("#sync-status").removeClass();
    if ($("#sync-status-spinner").is(":visible")) {
      $("#sync-status-spinner").hide();
    }

    let syncStatus = sanitizeHTML(`<div id="fh-svc-info">${browser.i18n.getMessage("connectedTo", fileHostName)}</div><input type="text" id="fh-usr-info" value="${fileHostUsr}" readonly>`);
    $("#sync-status").html(syncStatus);
    $("#retry-conn, #reauthorize").hide();
    toggleSyncBtn.text(browser.i18n.getMessage("btnDisconnect"));
  }
  else {
    $("#sync-icon").css({backgroundImage: ""}).removeClass().addClass("nosync");
    $("#sync-status").empty().removeClass().text(browser.i18n.getMessage("noSync"));
    toggleSyncBtn.text(browser.i18n.getMessage("btnConnect"));   
  }

  if (! toggleSyncBtn.is(":visible")) {
    toggleSyncBtn.css({display: "inline"});
  }
}


function setInitSyncProgressIndicator(aInProgress)
{
  if (aInProgress) {
    $(document.body).css({cursor: "progress"});
    $("#toggle-sync").attr("disabled", "true");
    $("#init-sync-spinner").css({display: "inline-block"});
  }
  else {
    $(document.body).css({cursor: "unset"});
    $("#toggle-sync").removeAttr("disabled");     
    $("#init-sync-spinner").hide();
  }
}


async function connectCloudFileSvc(aBackend)
{
  // Initialize cloud file host backend
  setInitSyncProgressIndicator(true);
  aeOAuth.init(aBackend);
  let authzCode, tokens;
  try {
    authzCode = await aeOAuth.getAuthorizationCode();
  }
  catch (e) {
    warn(e);

    if (e instanceof TypeError) {
      // TypeError: NetworkError when attempting to fetch resource.
      gDialogs.connectWiz.goToPage("authz-network-error");
    }
    else {
      gDialogs.connectWiz.goToPage("authz-retry");
    }
    setInitSyncProgressIndicator(false);
    return;
  }

  try {
    tokens = await aeOAuth.getAccessToken();
  }
  catch (e) {
    warn(e);

    if (e instanceof TypeError) {
      // TypeError: NetworkError when attempting to fetch resource.
      gDialogs.connectWiz.goToPage("authz-network-error");
    }
    else {
      gDialogs.connectWiz.goToPage("authz-retry");
    }
  }
  finally {
    setInitSyncProgressIndicator(false);
  }

  if (! tokens) {
    return;
  }

  gDialogs.connectWiz.goToPage("authz-success");

  let syncPrefs = {
    syncEnabled: true,
    syncBackend: aBackend,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };

  await aePrefs.setPrefs(syncPrefs);
  try {
    await browser.runtime.sendMessage({
      id: "sync-setting-changed",
      syncEnabled: syncPrefs.syncEnabled,
    });
  }
  catch {}

  showSyncStatus(syncPrefs);
}


//
// Event handlers
//

browser.runtime.onMessage.addListener(aMessage => {
  switch (aMessage.id) {
  case "open-connection-wiz":
    gDialogs.connectWiz.showModal();
    break;

  case "sync-reading-list":
    if (aMessage.isReauthorized) {
      // Update sync status if necessary.
      aePrefs.getAllPrefs().then(aPrefs => {
        showSyncStatus(aPrefs);
      });
    }
    break;

  default:
    break;
  }
});


$("#toggle-sync").on("click", async (aEvent) => {
  let syncEnabled = await aePrefs.getPref("syncEnabled");

  if (syncEnabled) {
    gDialogs.disconnectConfirm.showModal();
  }
  else {
    gDialogs.connectWiz.showModal();
  }
});


$("#retry-conn").on("click", async (aEvent) => {
  $("#sync-icon").removeClass().addClass("nosync");
  $("#sync-status").empty().removeClass();
  $("#sync-status-spinner").show();
  $("#retry-conn, #toggle-sync").hide();
  
  let prefs = await aePrefs.getAllPrefs();
  showSyncStatus(prefs);
});


$("#reauthorize").on("click", aEvent => {
  browser.runtime.sendMessage({id: "reauthorize"});
});


$("#about-btn").on("click", aEvent => { gDialogs.about.showModal() });


$(window).on("focus", async (aEvent) => {
  // This event handler is meant to be fired when the extension preferences page
  // was already opened and has been given the focus.  Skip if the page is just
  // being loaded.
  if (! gIsInitialized) {
    return;
  }

  // Check if the cloud file host connection wizard should be opened automatically.
  let openConnectWiz = await browser.runtime.sendMessage({id: "should-open-connect-wiz"});
  if (openConnectWiz) {
    gDialogs.connectWiz.showModal();
  } 
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
  else if (aEvent.key == " ") {
    if (aEvent.target.tagName == "A") {
      aEvent.target.click();
    }
  }
  else {
    aeInterxn.suppressBrowserShortcuts(aEvent, aeConst.DEBUG);
  }
});


$(document).on("contextmenu", aEvent => {
  if (aEvent.target.tagName != "INPUT" && aEvent.target.getAttribute("type") != "text") {
    aEvent.preventDefault();
  }
});


$(window).on("beforeunload", aEvent => {
  browser.runtime.sendMessage({
    id: "options-pg-status",
    isOpen: false,
  });
});


//
// Utilities
//

function sanitizeHTML(aHTMLStr)
{
  return DOMPurify.sanitize(aHTMLStr, { SAFE_FOR_JQUERY: true });
}


function gotoURL(aURL)
{
  browser.tabs.create({url: aURL});
}


function log(aMessage)
{
  if (aeConst.DEBUG) { console.log(aMessage) }
}

function warn(aMessage)
{
  if (aeConst.DEBUG) { console.warn(aMessage) }
}
