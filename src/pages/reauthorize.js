/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


// Page initialization
$(async () => {
  let platform = await browser.runtime.getPlatformInfo();
  document.body.dataset.os = platform.os;

  let msg = {
    id: "reauthz-pg-status",
    isOpen: true,
  };
  let tab = await browser.tabs.getCurrent();
  msg.tabID = tab.id;
  msg.wndID = tab.windowId;  
  browser.runtime.sendMessage(msg);

  let backnd = getFileHostID();
  reauthorize(backnd);  
});


function getFileHostID()
{
  let rv;
  let url = new URL(window.location.href);
  rv = url.searchParams.get("bknd");
  if (! rv) {
    throw new Error("URL parameter 'bknd' is invalid or undefined");
  }

  return rv;
}


async function reauthorize(aBackend)
{
  let backnd = Number(aBackend);
  aeOAuth.init(backnd);

  let authzCode, tokens;
  try {
    authzCode = await aeOAuth.getAuthorizationCode();
  }
  catch (e) {
    log("Read Next::reauthorize.js: " + e);

    if (e instanceof TypeError) {
      // TypeError: NetworkError when attempting to fetch resource.
      showNetworkErrorMsg();
    }
    else {
      showRetryPrompt(backnd);
    }
    
    return;
  }

  try {
    tokens = await aeOAuth.getAccessToken();
  }
  catch (e) {
    log("Read Next::reauthorize.js: " + e);
    showRetryPrompt(backnd);
    return;
  }

  let syncPrefs = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
  await aePrefs.setPrefs(syncPrefs);

  log("Read Next::reauthorize.js: Retrying reading list sync...");
  let msg = {
    id: "sync-reading-list",
    isReauthorized: true,
  };
  await browser.runtime.sendMessage(msg);
  closePage();
}


function showRetryPrompt(aBackend)
{
  $("#reauthz-progress").hide();

  let {fileHostName} = aeFileHostUI(aBackend);
  $("#retry-reauthz > #msgbox-content > p").text(browser.i18n.getMessage("reauthzRetry", fileHostName));
  $("#retry-reauthz").show();
}


function showNetworkErrorMsg()
{
  $("#reauthz-progress").hide();
  $("#retry-reauthz > #msgbox-content > p").text(browser.i18n.getMessage("wizAuthzNetErr"));
  $("#retry-reauthz").show();
}


async function closePage()
{
  let tab = await browser.tabs.getCurrent();
  browser.tabs.remove(tab.id);
}


//
// Event handlers
//

$("#btn-retry").on("click", aEvent => {
  $("#retry-reauthz").hide();
  $("#reauthz-progress").show();
  
  let backnd = getFileHostID();
  reauthorize(backnd);
});

$("#btn-cancel").on("click", async (aEvent) => { await closePage() });


$(window).keydown(aEvent => {
  if (aEvent.key == "Enter") {
    if (aEvent.target.tagName == "BUTTON" && !aEvent.target.classList.contains("default")) {
      aEvent.target.click();
    }
    else {
      $("#btn-retry").click();
    }
  }
  else if (aEvent.key == "Escape") {
    $("#btn-cancel").click();
  }
  else {
    aeInterxn.suppressBrowserShortcuts(aEvent);
  }
});


$(document).on("contextmenu", aEvent => {
  aEvent.preventDefault();
});


$(window).on("beforeunload", aEvent => {
  browser.runtime.sendMessage({
    id: "reauthz-pg-status",
    isOpen: false,
  });
});


//
// Utilities
//

function log(aMessage)
{
  if (aeConst.DEBUG) { console.log(aMessage) }
}
