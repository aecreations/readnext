/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let aeReadingList = {
  _db: null,
  
  init()
  {
    this._db = new Dexie("aeReadingList");

    this._db.version(1).stores({
      bookmarks: "id, title, createdAt, unread"
    });
  },
  
  async add(aBookmark)
  {
    if (! aBookmark.id) {
      throw new Error("Bookmark ID is invalid or undefined");
    }

    let rv;
    let db = this._getDB();
    
    // Throws exception if a bookmark with the same ID already exists.
    rv = await db.bookmarks.add(aBookmark, aBookmark.id);

    if (rv) {
      let msg = {
        id: "add-bookmark-event",
        bookmark: aBookmark,
      };
      browser.runtime.sendMessage(msg);

      this._updateLocalLastModifiedTime();
    }

    return rv;
  },

  async remove(aBookmarkID)
  {
    let db = this._getDB();
    await db.bookmarks.delete(aBookmarkID);

    let msg = {
      id: "remove-bookmark-event",
      bookmarkID: aBookmarkID,
    };
    browser.runtime.sendMessage(msg);

    this._updateLocalLastModifiedTime();
  },

  async get(aBookmarkID)
  {
    let rv;
    let db = this._getDB();
    rv = await db.bookmarks.get(aBookmarkID);

    return rv;
  },

  async getAll()
  {
    let rv;
    let db = this._getDB();
    rv = await db.bookmarks.orderBy("createdAt").toArray();
    
    return rv;
  },

  async getByURL(aURL)
  {
    let rv;
    let bkmks = await this.getAll();

    rv = bkmks.find(aBkmk => aBkmk.url == aURL);
    return rv;
  },

  // Helpers
  _getDB()
  {
    let rv;
    if (! this._db) {
      this.init();
    }
    rv = this._db;

    return rv;
  },

  async _updateLocalLastModifiedTime()
  {
    let now = new Date();
    await aePrefs.setPrefs({localLastModifiedTime: now.toUTCString()});
  },
};
