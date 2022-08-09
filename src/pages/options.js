/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */


let gDialogs = {};


// Page initialization
$(async () => {
  $("#unread-links-bold-label").html(sanitizeHTML(browser.i18n.getMessage("prefUnreadBold")));

  let prefs = await aePrefs.getAllPrefs();
  showSyncStatus(prefs, true);

  $("#auto-delete-when-read").prop("checked", prefs.deleteReadLinks).on("click", aEvent => {
    aePrefs.setPrefs({deleteReadLinks: aEvent.target.checked});
  });

  $("#add-awesome-bar").prop("checked", prefs.showPageAction).on("click", aEvent => {
    aePrefs.setPrefs({showPageAction: aEvent.target.checked});
  });

  $("#add-cxt-menu").prop("checked", prefs.showCxtMenu).on("click", aEvent => {
    aePrefs.setPrefs({showCxtMenu: aEvent.target.checked});
  });

  $("#unread-links-bold").prop("checked", prefs.boldUnreadBkmks).on("click", aEvent => {
    aePrefs.setPrefs({boldUnreadBkmks: aEvent.target.checked});
  });

  $("#show-toolbar").prop("checked", prefs.toolbar).on("click", aEvent => {
    aePrefs.setPrefs({toolbar: aEvent.target.checked});
  });

  $("#show-search-bar").prop("checked", prefs.searchBar).on("click", aEvent => {
    aePrefs.setPrefs({searchBar: aEvent.target.checked});
  });

  initDialogs();
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

    $("#sync-icon").css({backgroundImage: `url("${iconPath}")`});
    $("#sync-status").text(browser.i18n.getMessage("connectedTo", [fileHostName, fileHostUsr]));
    $("#toggle-sync").text(browser.i18n.getMessage("btnDisconnect"));

    if (aRefetchUserInfo) {
      // Refetch cloud file service user info to check if reauthz is required.
      await getFileHostUsr();
    }
  }
  else {
    $("#sync-icon").css({backgroundImage: `url("../img/syncReadingList.svg")`});
    $("#sync-status").text(browser.i18n.getMessage("noSync"));
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
    log("Read Next::options.js: Authorization code: " + authzCode);
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
    log("Read Next::options.js: Received access token and refresh token from authorization server: ");
    log(tokens);
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
    syncEnabledFromExtPrefs: true
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

  case "sync-setting-changed":
    // Reached here if reading list sync turned off by user revoking the
    // optional WebExtension permission "nativeMessaging".
    showSyncStatus(aMessage.syncEnabled);
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
    gDialogs.connectWiz.showModal(false);
  }
});


$("#reauthorize").on("click", aEvent => {
  browser.runtime.sendMessage({id: "reauthorize"});
});


$(document).on("contextmenu", aEvent => {
  if (aEvent.target.tagName != "INPUT" && aEvent.target.getAttribute("type") != "text") {
    aEvent.preventDefault();
  }
});

$("#about-btn").on("click", aEvent => { gDialogs.about.showModal() });

$(".hyperlink").click(aEvent => {
  aEvent.preventDefault();
  gotoURL(aEvent.target.href);
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
