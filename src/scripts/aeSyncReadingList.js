/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let aeSyncReadingList = {
  DEBUG: true,

  _fileHost: null,

  
  init(aFileHostID, aOAuthClient)
  {
    if (!aFileHostID || typeof aFileHostID != "number") {
      throw new Error("Invalid file host ID");
    }
    if (! (aOAuthClient instanceof aeOAuthClient)) {
      throw new TypeError("aOAuthClient not an aeOAuthClient");
    }

    this._fileHost = this.getFileHost(aFileHostID, aOAuthClient);
  },

  getFileHost(aFileHostID, aOAuthClient)
  {
    if (!aFileHostID || typeof aFileHostID != "number") {
      throw new Error("Invalid file host ID");
    }

    let rv = null;

    switch (aFileHostID) {
    case aeConst.FILEHOST_DROPBOX:
      rv = new aeDropbox(aOAuthClient);
      break;

    case aeConst.FILEHOST_GOOGLE_DRIVE:
      // TO DO: Support Google Drive.
    default:
      break;
    }

    return rv;
  },
  
  async firstSync()
  {
    let localBkmks = await aeReadingList.getAll();
    let syncFileExists = await this._fileHost.syncFileExists();

    if (syncFileExists) {
      this._log("aeSyncReadingList.firstSync(): Confirmed that the sync file exists.");
      let syncData = await this._fileHost.getSyncData();

      this._log("aeSyncReadingList.firstSync(): Sync data:");
      this._log(syncData);
      
      // Combine sync data with local bookmarks.
      await aeReadingList.bulkAdd(syncData);
    }
    else {
      this._log("aeSyncReadingList.firstSync(): Sync file not found; creating.");
      await this._fileHost.createSyncFile(localBkmks);
    }

  },
  

  // Helpers
  _log(aMessage) {
    if (this.DEBUG) {
      console.log(aMessage);
    }
  },
};
