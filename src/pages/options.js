/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */


let gDialogs = {};


// Page initialization
$(async () => {
  let prefs = await aePrefs.getAllPrefs();

  showSyncStatus(prefs);

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

  initDialogs();
});


function initDialogs()
{
  gDialogs.connectWiz = new aeDialog("#connect-dlg");
  gDialogs.connectWiz.setProps({
    backnd: null,
  });
  
  gDialogs.connectWiz.goToPage = function (aPageID)
  {
    $("#connect-dlg > .dlg-content > .wiz-page").hide();
    $(`#connect-dlg > .dlg-content > #${aPageID}`).show();

    let btnAccept = $("#connect-dlg > .dlg-btns > .dlg-accept");
    let btnCancel = $("#connect-dlg > .dlg-btns > .dlg-cancel");
    let fileHost = getFileHostUI(this.backnd);

    switch (aPageID) {
    case "drive-conn-svc":
      $("#connect-dlg > .dlg-btns > .dlg-accept").removeClass("default");
      break;

    case "authz-prologue":
      $("#connect-dlg > .dlg-btns > .dlg-accept").addClass("default");
      $("#connect-dlg #authz-instr").text(browser.i18n.getMessage("wizAuthzInstr1", fileHost.name));
      break;

    case "authz-progress":
      $("#connect-dlg > .dlg-btns > button").attr("disabled", "true");
      break;

    case "authz-success":
      $("#connect-dlg #authz-succs-msg").text(browser.i18n.getMessage("wizAuthzSuccs", fileHost.name));
      btnAccept.removeAttr("disabled").text(browser.i18n.getMessage("btnClose"));
      btnCancel.hide();
      break;

    case "authz-retry":
      $("#connect-dlg #authz-interrupt").text(browser.i18n.getMessage("wizAuthzInterrupt", fileHost.name));
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

  gDialogs.connectWiz.onFirstInit = function ()
  {
    $("#connect-dlg #select-file-host #file-hosts").on("click", aEvent => {
      $("#connect-dlg > .dlg-btns > .dlg-accept").removeAttr("disabled");
    });

    $("#connect-dlg #drive-conn-svc #dwnld-dcs").on("click", aEvent => {
      gotoURL(aeConst.DRIVE_CONN_SVC_DOWNLOAD_URL);
    }).attr("title", aeConst.DRIVE_CONN_SVC_DOWNLOAD_URL);
  };

  gDialogs.connectWiz.onInit = function ()
  {
    this.goToPage("select-file-host");
  };

  gDialogs.connectWiz.onAccept = async function ()
  {
    let currPg = this.getPageID();

    switch (currPg) {
    case "select-file-host":
      this.backnd = $("#connect-dlg #select-file-host #file-hosts")[0].selectedOptions[0].value;

      if (this.backnd == aeConst.FILEHOST_GOOGLE_DRIVE) {
        let dcsAppInfo = await getDriveConnectorInfo();
        if (dcsAppInfo) {
          console.info(`${dcsAppInfo.appName} version ${dcsAppInfo.appVersion}`);
          this.goToPage("authz-prologue");
        }
        else {
          this.goToPage("drive-conn-svc");
        }
      }
      else {
        this.goToPage("authz-prologue");
      }
      break;

    case "drive-conn-svc":
      let isNatvAppInstalled = await getDriveConnectorInfo();
      if (isNatvAppInstalled) {
        this.goToPage("authz-prologue");
      }
      else {
        warn("Read Next::options.js: Drive Connector Service not installed.");
      }
      break;

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
    this.goToPage("select-file-host");
    $("#connect-dlg #select-file-host #file-hosts")[0].selectedIndex = -1;
    $("#connect-dlg > .dlg-btns > .dlg-accept").addClass("default").attr("disabled", "true")
      .text(browser.i18n.getMessage("btnNext"));
    $("#connect-dlg > .dlg-btns > .dlg-cancel").removeAttr("disabled").show();
  };

  gDialogs.disconnectConfirm = new aeDialog("#disconnect-dlg");
  gDialogs.disconnectConfirm.onInit = async function ()
  {
    let syncBackend = await aePrefs.getPref("syncBackend");
    let fileHost = getFileHostUI(syncBackend);

    $("#disconnect-dlg > .dlg-content > .msgbox-content > #disconnect-confirm").text(browser.i18n.getMessage("disconnTitle", fileHost.name));
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
    setSyncStatus(syncPrefs.syncEnabled);
  };
}


async function showSyncStatus(aPrefs)
{
  if (aPrefs.syncEnabled) {
    let fileHost = getFileHostUI(aPrefs.syncBackend);
    let fileHostUsr = aPrefs.fileHostUsr;

    if (! fileHostUsr) {
      fileHostUsr = await browser.runtime.sendMessage({id: "get-username"});
      aePrefs.setPrefs({fileHostUsr});
    }

    $("#sync-icon").css({backgroundImage: `url("${fileHost.iconPath}")`});
    $("#sync-status").text(browser.i18n.getMessage("connectedTo", [fileHost.name, fileHostUsr]));
    $("#toggle-sync").text(browser.i18n.getMessage("btnDisconnect"));
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


function getFileHostUI(aFileHostID)
{
  let rv;
  let backnd = Number(aFileHostID);
  
  switch (backnd) {
  case aeConst.FILEHOST_DROPBOX:
    rv = {
      name: browser.i18n.getMessage("fhDropbox"),
      iconPath: "../img/dropbox.svg",
    };
    break;

  case aeConst.FILEHOST_GOOGLE_DRIVE:
    rv = {
      name: browser.i18n.getMessage("fhGoogleDrive"),
      iconPath: "../img/googledrive.svg",
    };
    break;

  case aeConst.FILEHOST_ONEDRIVE:
    rv = {
      name: browser.i18n.getMessage("fhOneDrive"),
      iconPath: "../img/onedrive.svg",
    };
    break;

  default:
    break;
  }

  return rv;
  
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


async function getDriveConnectorInfo()
{
  let rv;
  let msg = {id: "get-app-version"};

  try {
    rv = await browser.runtime.sendNativeMessage(aeConst.DRIVE_CONNECTOR_SVC_APP_NAME, msg);
  }
  catch (e) {
    console.error("Error connecting to Drive Connector Service: " + e);
  }

  return rv;
}


//
// Event handlers
//

$("#toggle-sync").on("click", async (aEvent) => {
  let syncEnabled = await aePrefs.getPref("syncEnabled");

  if (syncEnabled) {
    gDialogs.disconnectConfirm.showModal();
  }
  else {
    gDialogs.connectWiz.showModal(false);
  }
});


$(document).on("contextmenu", aEvent => {
  if (aEvent.target.tagName != "INPUT" && aEvent.target.getAttribute("type") != "text") {
    aEvent.preventDefault();
  }
});

$(".hyperlink").click(aEvent => {
  aEvent.preventDefault();
  gotoURL(aEvent.target.href);
});


//
// Utilities
//

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
