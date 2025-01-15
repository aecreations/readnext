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
    this._db.version(2).stores({
      favicons: "id"
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
      try {
        await browser.runtime.sendMessage({
          id: "bookmark-added",
          bookmark: aBookmark,
        });
      }
      catch {}
      
      this._updateLocalLastModifiedTime();
    }

    return rv;
  },

  async rename(aBookmarkID, aName)
  {
    let db = this._getDB();
    let changes = {
      title: aName,
      updatedAt: new Date().toISOString(),
    };
    
    await db.bookmarks.update(aBookmarkID, changes);
    this._updateLocalLastModifiedTime();
  },

  async bulkAdd(aBookmarks)
  {
    let db = this._getDB();

    try {
      await db.bookmarks.bulkAdd(aBookmarks);
    }
    catch (e) {
      // Exception thrown if attempting to add a bookmark with the same ID as
      // an existing bookmark.
      console.warn("aeReadingList.bulkAdd(): " + e);
    }

    this._updateLocalLastModifiedTime();
  },

  async setFavIcon(aBookmarkID, aIconData)
  {
    let db = this._getDB();

    await db.favicons.put({
      id: aBookmarkID,
      iconData: aIconData,
    });

    try {
      await browser.runtime.sendMessage({
        id: "favicon-saved",
        bookmarkID: aBookmarkID,
        iconData: aIconData,
      });
    }
    catch {}
  },

  async getFavIconMap()
  {
    let rv;
    let favIconMap = new Map();
    let db = this._getDB();
    let favicons = await db.favicons.toArray();

    favicons.forEach(aItem => { favIconMap.set(aItem.id, aItem.iconData) });
    rv = favIconMap;

    return rv;
  },

  async remove(aBookmarkID)
  {
    let bookmark = await this.get(aBookmarkID);
    let db = this._getDB();
    await db.bookmarks.delete(aBookmarkID);
    await db.favicons.delete(aBookmarkID);

    try {
      await browser.runtime.sendMessage({
        id: "bookmark-removed",
        bookmark,
      });
    }
    catch {}

    this._updateLocalLastModifiedTime();
  },

  async removeAll()
  {
    let db = this._getDB();
    await db.bookmarks.clear();
    await db.favicons.clear();
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

  async findByTitle(aSearchTerm)
  {
    let rv;
    let db = this._getDB();
    let bkmks = await this.getAll();
    let regex = new RegExp(aSearchTerm, "iu");

    rv = bkmks.filter(aBkmk => regex.test(aBkmk.title));

    return rv;
  },

  async markAsRead(aBookmarkID, aIsRead)
  {
    let db = this._getDB();
    let changes = {
      unread: !aIsRead,
      updatedAt: new Date().toISOString(),
    };
    await db.bookmarks.update(aBookmarkID, changes);

    try {
      await browser.runtime.sendMessage({
        id: "marked-as-read",
        bookmarkID: aBookmarkID,
        isRead: aIsRead,
      });
    }
    catch {}
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
    await aePrefs.setPrefs({localLastModifiedTime: now.toISOString()});
  },
};
