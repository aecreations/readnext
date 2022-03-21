/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


async function init()
{
  let platform = await browser.runtime.getPlatformInfo();
  document.body.dataset.os = platform.os;

  let url = new URL(window.location.href);
  let backnd = url.searchParams.get("bknd");
  if (! backnd) {
    throw new Error("URL parameter 'bknd' is invalid or undefined");
  }
  backnd = Number(backnd);

  aeOAuth.init(backnd);
  let authzCode, tokens;
  try {
    authzCode = await aeOAuth.getAuthorizationCode();
    log("Read Next::reauthorize.js: Authorization code: " + authzCode);
  }
  catch (e) {
    showErrorMsgDeck(e);
    return;
  }

  try {
    tokens = await aeOAuth.getAccessToken();
    log("Read Next::reauthorize.js: Received access token and refresh token from authorization server: ");
    log(tokens);
  }
  catch (e) {
    showErrorMsgDeck(e);
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


function showErrorMsgDeck(aErrorMsg)
{
  $("#reauthz-progress").hide();

  $("#reauthz-error > #msgbox-content > p").text(aErrorMsg);
  $("#reauthz-error").show();
}


async function closePage()
{
  let tab = await browser.tabs.getCurrent();
  browser.tabs.remove(tab.id);
}


//
// Event handlers
//

document.addEventListener("DOMContentLoaded", async (aEvent) => {
  init();
});


document.addEventListener("keydown", aEvent => {
  aeInterxn.suppressBrowserShortcuts(aEvent, false);
});


document.addEventListener("contextmenu", aEvent => {
  aEvent.preventDefault();
});


$("#btn-accept").on("click", aEvent => { closePage() });


//
// Utilities
//

function log(aMessage)
{
  if (aeConst.DEBUG) { console.log(aMessage) }
}
