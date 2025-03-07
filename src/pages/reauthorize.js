/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


let gPgInfo = {
  tabID: null,
  wndID: null,
};


// Page initialization
$(async () => {
  let platform = await browser.runtime.getPlatformInfo();
  document.body.dataset.os = platform.os;
  aeInterxn.init(platform.os);

  let tab = await browser.tabs.getCurrent();
  gPgInfo.tabID = tab.id;
  gPgInfo.wndID = tab.windowId;  

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

  // If reading list sync was paused, force syncing to resume.
  await browser.runtime.sendMessage({id: "force-resume-sync"});

  log("Read Next::reauthorize.js: Retrying reading list sync...");
  await browser.runtime.sendMessage({
    id: "sync-reading-list",
    isReauthorized: true,
  });
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

browser.runtime.onMessage.addListener(aMessage => {
  log(`Read Next::reauthorize.js: Received extension message "${aMessage.id}"`);

  if (aMessage.id == "ping-reauthz-pg") {
    return Promise.resolve({
      isOpen: true,
      tabID: gPgInfo.tabID,
      wndID: gPgInfo.wndID,
    });
  }
});


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


//
// Utilities
//

function log(aMessage)
{
  if (aeConst.DEBUG) { console.log(aMessage) }
}
