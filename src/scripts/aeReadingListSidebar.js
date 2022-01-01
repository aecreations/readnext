/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeReadingListSidebar
{
  constructor() {}

  async add(aBookmark)
  {
    if (! aBookmark.id) {
      throw new Error("Bookmark ID is invalid or undefined");
    }

    let rv;
    let msg = {
      id: "add-bookmark",
      bookmark: aBookmark,
    };

    try {
      rv = await browser.runtime.sendMessage(msg);
    }
    catch (e) {
      console.error("aeReadingListSidebar.add(): " + e);
      throw e;
    }

    return rv;
  }

  remove(aBookmarkID)
  {
    let msg = {
      id: "remove-bookmark",
      bookmarkID: aBookmarkID,
    };
    
    browser.runtime.sendMessage(msg);
  }

  async getAll()
  {
    let rv;
    let msg = {
      id: "get-all-bookmarks"
    };

    rv = await browser.runtime.sendMessage(msg);    
    return rv;
  }

  getIDFromURL(aURL)
  {
    return this._urlHash(aURL);
  }

  // Helper method
  _urlHash(aURL)
  {
    return md5(aURL);
  }
}
