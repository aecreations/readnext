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
  if (platform.os == "win") {
    document.title = browser.i18n.getMessage("prefsTitleWin");
    $("#pref-hdg").text(browser.i18n.getMessage("prefsHdgWin"));
  }
  else {
    document.title = browser.i18n.getMessage("prefsTitle");
    $("#pref-hdg").text(browser.i18n.getMessage("prefsHdg"));
  }

  $("#close-tab-after-add-desc").html(sanitizeHTML(browser.i18n.getMessage("closeTabAfterAddDesc")));

  let prefs = await aePrefs.getAllPrefs();
  showSyncStatus(prefs, true);

  $("#auto-delete-when-read").prop("checked", prefs.deleteReadLinks).on("click", aEvent => {
    aePrefs.setPrefs({deleteReadLinks: aEvent.target.checked});
  });

  $("#add-awesome-bar").prop("checked", prefs.showPageAction).on("click", aEvent => {
    let showPageAction = aEvent.target.checked;
    aePrefs.setPrefs({showPageAction});
    if (showPageAction) {
      $("#close-tab-after-add-desc").show();
    }
    else {
      $("#close-tab-after-add-desc").hide();
    }
  });

  $("#add-cxt-menu").prop("checked", prefs.showCxtMenu).on("click", aEvent => {
    aePrefs.setPrefs({showCxtMenu: aEvent.target.checked});
  });

  $("#close-tab-after-add").prop("checked", prefs.closeTabAfterAdd).on("click", aEvent => {
    aePrefs.setPrefs({closeTabAfterAdd: aEvent.target.checked});
  });

  initDialogs();
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
    $("#connect-dlg > .dlg-content > .wiz-page").hide();
    $(`#connect-dlg > .dlg-content > #${aPageID}`).show();

    let btnAccept = $("#connect-dlg > .dlg-btns > .dlg-accept");
    let btnCancel = $("#connect-dlg > .dlg-btns > .dlg-cancel");
    let {fileHostName} = aeFileHostUI(this.backnd);

    switch (aPageID) {
    case "authz-prologue":
      $("#connect-dlg > .dlg-btns > .dlg-accept").addClass("default");
      $("#connect-dlg #authz-instr").text(browser.i18n.getMessage("wizAuthzInstr1", fileHostName));
      break;

    case "authz-progress":
      $("#connect-dlg > .dlg-btns > button").attr("disabled", "true");
      break;

    case "authz-success":
      $("#connect-dlg #authz-succs-msg").text(browser.i18n.getMessage("wizAuthzSuccs", fileHostName));
      btnAccept.removeAttr("disabled").text(browser.i18n.getMessage("btnClose"));
      btnCancel.hide();
      this.changeKeyboardNavigableElts([btnAccept.get(0)]);
      break;

    case "authz-retry":
      $("#connect-dlg #authz-interrupt").text(browser.i18n.getMessage("wizAuthzInterrupt", fileHostName));
      $("#connect-dlg > .dlg-btns > button").removeAttr("disabled");
      btnAccept.text(browser.i18n.getMessage("btnRetry"));
      break;

    case "authz-network-error":
      $("#connect-dlg > .dlg-btns > button").removeAttr("disabled");
      btnAccept.text(browser.i18n.getMessage("btnRetry"));
      break;

    default:
      break;
    }
  };

  gDialogs.connectWiz.getPageID = function ()
  {
    let rv;
    let pages = $("#connect-dlg > .dlg-content > .wiz-page").toArray();
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
    $("#connect-dlg > .dlg-btns > .dlg-accept").addClass("default")
      .text(browser.i18n.getMessage("btnNext"));
    $("#connect-dlg > .dlg-btns > .dlg-cancel").removeAttr("disabled").show();
  };

  gDialogs.disconnectConfirm = new aeDialog("#disconnect-dlg");
  gDialogs.disconnectConfirm.onInit = async function ()
  {
    let syncBackend = await aePrefs.getPref("syncBackend");
    let {fileHostName} = aeFileHostUI(syncBackend);

    $("#disconnect-dlg > .dlg-content > .msgbox-content > #disconnect-confirm").text(browser.i18n.getMessage("disconnTitle", fileHostName));
  };

  gDialogs.disconnectConfirm.onAccept = async function ()
  {
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
  };

  gDialogs.about = new aeDialog("#about-dlg");
  gDialogs.about.extInfo = null;
  gDialogs.about.onFirstInit = function ()
  {
    let extManifest = browser.runtime.getManifest();
    this.extInfo = {
      name: extManifest.name,
      version: extManifest.version,
      description: extManifest.description,
      homePgURL: extManifest.homepage_url,
    };

    $("#ext-name").text(this.extInfo.name);
    $("#ext-ver").text(browser.i18n.getMessage("aboutExtVer", this.extInfo.version));
    $("#ext-desc").text(this.extInfo.description);
    $("#ext-home-pg-link").attr("href", this.extInfo.homePgURL);
  };  
}


async function showSyncStatus(aPrefs, aRefetchUserInfo=false)
{
  async function getFileHostUsr()
  {
    let rv;
    try {
      rv = await browser.runtime.sendMessage({id: "get-username"});
    }
    catch {} 
    return rv;
  }
  // END nested function

  if (aPrefs.syncEnabled) {
    let {fileHostName, iconPath} = aeFileHostUI(aPrefs.syncBackend);
    let fileHostUsr = aPrefs.fileHostUsr;

    if (! fileHostUsr) {
      fileHostUsr = await getFileHostUsr();

      if (fileHostUsr) {
        aePrefs.setPrefs({fileHostUsr});
      }
      else {
        fileHostUsr = "";
      }
    }

    $("#sync-icon").removeClass("nosync");
    $("#sync-icon").css({backgroundImage: `url("${iconPath}")`});

    let syncStatus = sanitizeHTML(`<span id="fh-svc-info">${browser.i18n.getMessage("connectedTo", fileHostName)}</span><br><span id="fh-usr-info">${fileHostUsr}</span>`);
    $("#sync-status").html(syncStatus);
    $("#toggle-sync").text(browser.i18n.getMessage("btnDisconnect"));

    if (aRefetchUserInfo) {
      // Refetch cloud file service user info to check if reauthz is required.
      await getFileHostUsr();
    }
  }
  else {
    $("#sync-icon").css({backgroundImage: ""}).addClass("nosync");
    $("#sync-status").empty().text(browser.i18n.getMessage("noSync"));
    $("#toggle-sync").text(browser.i18n.getMessage("btnConnect"));   
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
      $("#reauthz-msgbar").css({display: "none"});
    }
    break;

  case "sync-failed-authz-error":
    aePrefs.getPref("syncBackend").then(aSyncBacknd => {
      let {fileHostName} = aeFileHostUI(aSyncBacknd);
      $("#reauthz-msgbar-content").text(browser.i18n.getMessage("reauthzMsgBar", fileHostName));
      $("#reauthz-msgbar").css({display: "flow-root"});
    });
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


$("#reauthorize").on("click", aEvent => {
  browser.runtime.sendMessage({id: "reauthorize"});
});


$("#about-btn").on("click", aEvent => { gDialogs.about.showModal() });

$(".hyperlink").click(aEvent => {
  aEvent.preventDefault();
  gotoURL(aEvent.target.href);
});


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
