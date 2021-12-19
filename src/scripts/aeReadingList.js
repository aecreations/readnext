/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let aeReadingList = {
  _db: null,
  _onAdd(aBookmark) {},
  _onRemove(aBookmarkID) {},
  
  
  init()
  {
    this._db = new Dexie("aeReadingList");

    this._db.version(1).stores({
      bookmarks: "id, title, createdAt, unread"
    });
  },
  
  async add(aBookmark)
  {
    let rv = null;
    
    if (typeof aBookmark.id == "undefined") {
      throw new Error("Bookmark ID not defined");
    }
    
    // Throws exception if a bookmark with the same ID already exists.
    rv = await this._db.bookmarks.add(aBookmark, aBookmark.id);

    if (rv) {
      this._onAdd(aBookmark);
    }

    return rv;
  },

  async remove(aBookmarkID)
  {
    await this._db.bookmarks.delete(aBookmarkID);
    this._onRemove(aBookmarkID);
  },

  async get(aBookmarkID)
  {
    let rv = await this._db.bookmarks.get(aBookmarkID);

    return rv;
  },

  async getAll()
  {
    let rv = await this._db.bookmarks.orderBy("createdAt").toArray();

    return rv;
  },

  async getByURL(aURL)
  {
    let rv;
    let bkmks = await this.getAll();

    rv = bkmks.find(aBkmk => aBkmk.url == aURL);
    return rv;
  },

  getIDFromURL(aURL)
  {
    return this._urlHash(aURL);
  },

  set onAdd(aFnAdd)
  {
    this._onAdd = aFnAdd;
  },

  set onRemove(aFnRemove)
  {
    this._onRemove = aFnRemove;
  },

  
  //
  // Helper methods
  //
  
  _urlHash(aURL)
  {
    return md5(aURL);
  },
};
