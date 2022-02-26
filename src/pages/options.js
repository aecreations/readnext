/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */


// Page initialization
$(async () => {
  let prefs = await aePrefs.getAllPrefs();

  setSyncStatus(prefs.syncEnabled);

  $("#auto-delete-when-read").prop("checked", prefs.deleteReadLinks).on("click", aEvent => {
    aePrefs.setPrefs({deleteReadLinks: aEvent.target.checked});
  });

  $("#add-awesome-bar").prop("checked", prefs.showPageAction).on("click", aEvent => {
    aePrefs.setPrefs({showPageAction: aEvent.target.checked});
  });

  $("#add-cxt-menu").prop("checked", prefs.showCxtMenu).on("click", aEvent => {
    aePrefs.setPrefs({showCxtMenu: aEvent.target.checked});
  });
});


function setSyncStatus(aIsSyncEnabled)
{
  if (aIsSyncEnabled) {
    $("#sync-status").text("status: Connected 🟢");
    $("#toggle-sync").text("disconnect");
  }
  else {
    $("#sync-status").text("status: Disconnected ⚪️");
    $("#toggle-sync").text("connect");
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



//
// Event handlers
//

$("#toggle-sync").on("click", async (aEvent) => {
  let syncPrefs = {
    syncEnabled: false,
    syncBackend: null,
    accessToken: null,
    refreshToken: null,
  };
  let syncEnabled = await aePrefs.getPref("syncEnabled");

  if (syncEnabled) {
    let confirmTurnOff = window.confirm("disconnect from remote storage?");

    if (! confirmTurnOff) {
      return;
    }

    try {
      await browser.runtime.sendMessage({id: "sync-disconnected-from-ext-prefs"});
    }
    catch {}
  }
  else {
    let backend = window.prompt("backend to use (1=Dropbox, 2=Google Drive, 3=OneDrive):", "1");
    if (! backend) {
      return;
    }

    // Initialize cloud file host backend
    setInitSyncProgressIndicator(true);
    aeOAuth.init(backend);
    let authzCode, tokens;
    try {
      authzCode = await aeOAuth.getAuthorizationCode();
      log("Read Next::options.js: Authorization code: " + authzCode);
    }
    catch (e) { alert(e) }

    if (aeConst.DEBUG) {
      let url = new URL(window.location.href);
      let isAuthzCodeOnly = url.searchParams.get("authcodeonly");
      if (isAuthzCodeOnly) {
        alert("authorization code:\n" + authzCode);
        return;
      }
    }

    try {
      tokens = await aeOAuth.getAccessToken();
      log("Read Next::options.js: Received access token and refresh token from authorization server: ");
      log(tokens);
    }
    catch (e) {
      window.alert(e);
    }
    finally {
      setInitSyncProgressIndicator(false);
    }

    if (! tokens) {
      return;
    }

    if (backend == aeConst.FILEHOST_GOOGLE_DRIVE) {
      let msg = {id: "get-app-version"};
      let resp;
      try {
        resp = await browser.runtime.sendNativeMessage(aeConst.DRIVE_CONNECTOR_SVC_APP_NAME, msg);
        console.info(`${resp.appName} version ${resp.appVersion}`);
      }
      catch (e) {
        console.error("Error connecting to Drive Connector Service: " + e);
        alert("driveConnectorSvc not installed");
      }
    }

    syncPrefs = {
      syncEnabled: true,
      syncBackend: backend,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      syncEnabledFromExtPrefs: true
    };
  }

  await aePrefs.setPrefs(syncPrefs);
  try {
    await browser.runtime.sendMessage({
      id: "sync-setting-changed",
      syncEnabled: syncPrefs.syncEnabled,
    });
  }
  catch {}
  
  setSyncStatus(syncPrefs.syncEnabled);
});


$(document).on("contextmenu", aEvent => {
  if (aEvent.target.tagName != "INPUT" && aEvent.target.getAttribute("type") != "text") {
    aEvent.preventDefault();
  }
});


//
// Utilities
//

function log(aMessage)
{
  if (aeConst.DEBUG) { console.log(aMessage) }
}
