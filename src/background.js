/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


browser.runtime.onInstalled.addListener(async (aInstall) => {
  if (aInstall.reason == "install") {
    log("Read Next: Extension installed.");

    await setDefaultPrefs();
    init();
  }
});

browser.runtime.onStartup.addListener(() => {
  log("Read Next: Initializing extension during browser startup.");
  init();
});


async function setDefaultPrefs()
{
  let defaultPrefs = aePrefs.getDefaultPrefs();
  await aePrefs.setPrefs(defaultPrefs);
}


function init()
{
  aeReadingList.init();
}


//
// Event handlers
//

browser.runtime.onMessage.addListener(async (aMessage) => {
  log(`Read Next: Background script received extension message "${aMessage.id}"`);

  switch (aMessage.id) {
  case "add-bookmark":
    let bookmarkID;
    try {
      bookmarkID = await aeReadingList.add(aMessage.bookmark);
    }
    catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(bookmarkID);

  case "remove-bookmark":
    aeReadingList.remove(aMessage.bookmarkID);
    break;

  case "get-all-bookmarks":
    let bookmarks = await aeReadingList.getAll();
    return Promise.resolve(bookmarks);

  default:
    break;
  }
});


//
// Utilities
//

function log(aMessage)
{
  if (aeConst.DEBUG) { console.log(aMessage) }
}
