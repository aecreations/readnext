/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let aeSyncReadingList = {
  _fileHost: null,
  _prefs: null,

  
  async init(aFileHostID, aOAuthClient)
  {
    if (!aFileHostID || typeof aFileHostID != "number") {
      throw new Error("Invalid file host ID");
    }
    if (! (aOAuthClient instanceof aeOAuthClient)) {
      throw new TypeError("aOAuthClient not an aeOAuthClient");
    }

    this._prefs = await aePrefs.getAllPrefs();
    this._fileHost = await this.getFileHost(aFileHostID, aOAuthClient);
  },

  async getFileHost(aFileHostID, aOAuthClient)
  {
    if (!aFileHostID || typeof aFileHostID != "number") {
      throw new Error("Invalid file host ID");
    }

    let rv = null;

    switch (aFileHostID) {
    case aeConst.FILEHOST_DROPBOX:
      rv = new aeDropbox(aOAuthClient);
      break;

    case aeConst.FILEHOST_ONEDRIVE:
      rv = new aeOneDrive(aOAuthClient);
      break;

    case aeConst.FILEHOST_GOOGLE_DRIVE:
      let googleDrive = new aeGoogleDrive(aOAuthClient, this._prefs.readingListSliceLength);
      let syncFileID = this._prefs.syncFileID;
      await googleDrive.setSyncFileID(syncFileID);
      rv = googleDrive;
      break;

    default:
      break;
    }

    return rv;
  },

  reset()
  {
    this._fileHost = null;
  },
  
  async firstSync()
  {
    let localBkmks = await aeReadingList.getAll();
    let syncFileExists = await this._fileHost.syncFileExists();

    if (syncFileExists) {
      this._log("aeSyncReadingList.firstSync(): Confirmed that the sync file exists.");

      let syncLastModT;
      if (aeConst.DEBUG) {
        try {
          syncLastModT = await this._fileHost.getLastModifiedTime();
        }
        catch (e) {
          console.error("aeSyncReadingList.sync(): " + e);
        }
        this._log(`Sync file timestamp: ${syncLastModT}`);
      }

      let syncData = await this._fileHost.getSyncData();

      this._log(`aeSyncReadingList.firstSync(): Sync data (${syncData.length} items):`);
      this._log(syncData);
      
      // Combine sync data with local bookmarks.
      await aeReadingList.bulkAdd(syncData);
      if (localBkmks.length > 0) {
        let updLocalBkmks = await aeReadingList.getAll();
        syncLastModT = await this._fileHost.setSyncData(updLocalBkmks);
        this._setLocalLastModifiedTime(syncLastModT);
      }
    }
    else {
      this._log("aeSyncReadingList.firstSync(): Sync file not found; creating.");
      await this._fileHost.createSyncFile(localBkmks);
    }
  },

  async sync()
  {
    let rv;
    let syncLastModT;
    try {
      syncLastModT = await this._fileHost.getLastModifiedTime();
    }
    catch (e) {
      this._log("aeSyncReadingList.sync(): Error: " + e);
      throw e;
    }
    
    let localLastModT = this._getLocalLastModifiedTime();

    this._log(`aeSyncReadingList.sync(): Local last modified: ${localLastModT}\nSync last modified: ${syncLastModT}`);

    if (localLastModT < syncLastModT) {
      await this.pull(syncLastModT);
      rv = true;
    }
    else if (localLastModT > syncLastModT) {
      await this.push();
      rv = false;
    }
    else {
      this._log("aeSyncReadingList.sync(): The local data and sync data are the same.");
      rv = false;
    }

    return rv;
  },


  async push(aForceCreateSyncFile=false)
  {
    this._log("aeSyncReadingList.push(): Replacing sync data with local reading list data.");

    let localData = await aeReadingList.getAll();
    let syncModT, retry = false;
    
    try {
      syncModT = await this._fileHost.setSyncData(localData);
    }
    catch (e) {
      if (e instanceof aeAuthorizationError) {
        this._log("aeSyncReadingList.push(): Error: " + e);
        throw e;
      }
      else if (e instanceof aeNotFoundError) {
        if (aForceCreateSyncFile) {
          retry = true;
        }
        else {
          this._log("aeSyncReadingList.push(): Error: " + e);
          throw e;
        }
      }
      else {
        this._log("aeSyncReadingList.push(): Error: " + e);
        throw e;
      }
    }

    if (retry) {
      try {
        syncModT = await this._fileHost.createSyncFile(localData);
      }
      catch (e) {
        this._log("aeSyncReadingList.push(): Failed to force sync file creation: " + e);
        throw e;
      }
    }
    await this._setLocalLastModifiedTime(syncModT);
  },


  async pull(aSyncModifiedTime)
  {
    if (! aSyncModifiedTime) {
      aSyncModifiedTime = await this._fileHost.getLastModifiedTime();
    }

    this._log("aeSyncReadingList.pull(): Replacing local reading list data with sync data.");

    let syncData;
    try {
      syncData = await this._fileHost.getSyncData();
    }
    catch (e) {
      this._log("aeSyncReadingList.pull(): Error: " + e);
      throw e;
    }
    this._log(`aeSyncReadingList.pull(): Sync data (${syncData.length} items):`);
    this._log(syncData);

    await aeReadingList.removeAll();
    await aeReadingList.bulkAdd(syncData);
    await this._setLocalLastModifiedTime(aSyncModifiedTime);
  },


  async getFileHostUsername()
  {
    let rv = await this._fileHost.getUsername();

    return rv;
  },
  

  //
  // Helpers
  //

  _getLocalLastModifiedTime()
  {
    let rv;
    let localLastMod = this._prefs.localLastModifiedTime;
    rv = new Date(localLastMod);

    return rv;
  },

  async _setLocalLastModifiedTime(aLastModifiedTime)
  {
    if (! (aLastModifiedTime instanceof Date)) {
      throw new TypeError("aLastModifiedTime not a Date");
    }

    let localLastModifiedTime = aLastModifiedTime.toISOString();
    await aePrefs.setPrefs({localLastModifiedTime});
  },
  
  _log(aMessage)
  {
    if (aeConst.DEBUG) { console.log(aMessage) }
  },
};
