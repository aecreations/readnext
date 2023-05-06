/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let aePrefs = {
  _defaultPrefs: {
    syncEnabled: false,
    syncBackend: null,
    accessToken: null,
    refreshToken: null,
    fileHostUsr: null,
    deleteReadLinks: false,
    localLastModifiedTime: null,
    syncInterval: aeConst.SYNC_INTERVAL_MINS,
    showPageAction: true,
    showCxtMenu: true,
    boldUnreadBkmks: true,
    toolbar: true,
    searchBar: true,
    closeTabAfterAdd: false,
    closeSidebarAfterNav: false,

    // Applicable to Google Drive file host.
    syncFileID: null,
    readingListSliceLength: aeConst.DCS_READING_LIST_SLICE_LENGTH,
  },

  
  getPrefKeys()
  {
    return Object.keys(this._defaultPrefs);
  },

  async getPref(aPrefName)
  {
    let pref = await browser.storage.local.get(aPrefName);
    let rv = pref[aPrefName];
    
    return rv;
  },

  async getAllPrefs()
  {
    let rv = await browser.storage.local.get(this.getPrefKeys());
    return rv;
  },

  async setPrefs(aPrefMap)
  {
    await browser.storage.local.set(aPrefMap);
  },


  //
  // Version upgrade handling
  //

  hasUserPrefs(aPrefs)
  {
    return ("syncEnabled" in aPrefs);
  },

  async setUserPrefs(aPrefs) {
    let prefs = {
      syncEnabled: false,
      syncBackend: null,
      accessToken: null,
      refreshToken: null,
      fileHostUsr: null,
      deleteReadLinks: false,
      localLastModifiedTime: null,
      syncInterval: aeConst.SYNC_INTERVAL_MINS,
      showPageAction: true,
      showCxtMenu: true,
      boldUnreadBkmks: true,
      toolbar: true,
      searchBar: true,
      syncFileID: null,
      readingListSliceLength: aeConst.DCS_READING_LIST_SLICE_LENGTH,      
    };
    
    await this._addPrefs(aPrefs, prefs);
  },

  hasPomaikaiPrefs(aPrefs)
  {
    // Version 0.8.3
    return ("closeTabAfterAdd" in aPrefs);
  },

  async setPomaikaiPrefs(aPrefs)
  {
    let prefs = {
      closeTabAfterAdd: false,
    };
    await this._addPrefs(aPrefs, prefs);
  },

  hasMauiPrefs(aPrefs)
  {
    // Version 1.1
    return ("closeSidebarAfterNav" in aPrefs);
  },

  async setMauiPrefs(aPrefs)
  {
    let prefs = {
      closeSidebarAfterNav: false,
    };
    await this._addPrefs(aPrefs, prefs);
  },


  //
  // Helper methods
  //

  async _addPrefs(aCurrPrefs, aNewPrefs)
  {
    for (let pref in aNewPrefs) {
      aCurrPrefs[pref] = aNewPrefs[pref];
    }

    await this.setPrefs(aNewPrefs);
  },
};
