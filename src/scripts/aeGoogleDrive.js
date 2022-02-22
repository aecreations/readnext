/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeGoogleDrive extends aeAbstractFileHost
{
  _syncFileID = null;
  _sliceLen = aeConst.DCS_READING_LIST_SLICE_LENGTH;


  constructor(aOAuthClient, aSliceLength)
  {
    super(aOAuthClient);
    this._sliceLen = aSliceLength;
  }

  setSyncFileID(aSyncFileID)
  {
    this._syncFileID = aSyncFileID;
  }

  async syncFileExists()
  {
    let rv;
    let msg = this._getNativeMsgReq();
    msg.id = "sync-file-exists";
    
    let resp = await browser.runtime.sendNativeMessage(aeConst.DRIVE_CONNECTOR_SVC_APP_NAME, msg);

    if (resp.syncFileExists && !this._syncFileID) {
      this._syncFileID = resp.syncFileID;
      await aePrefs.setPrefs({syncFileID: resp.syncFileID});
    }

    rv = resp.syncFileExists;
    this._refreshAccessToken(resp);
    
    return rv;
  }

  async createSyncFile(aLocalData)
  {
    let rv;
    let msg = this._getNativeMsgReq();
    msg.id = "create-sync-file";
    msg.syncData = aLocalData;
    
    let resp = await browser.runtime.sendNativeMessage(aeConst.DRIVE_CONNECTOR_SVC_APP_NAME, msg);

    this._syncFileID = resp.syncFileID;
    await aePrefs.setPrefs({syncFileID: resp.syncFileID});
    
    rv = new Date(resp.fileCreatedTime);
    this._refreshAccessToken(resp);
    
    return rv;
  }

  async getSyncData()
  {
    if (! this._syncFileID) {
      throw new ReferenceError("Google Drive sync file ID not initialized");
    }

    let rv;
    let startIdx = 0;
    let msg = this._getNativeMsgReq();
    msg.id = "get-sync-data";
    msg.startIdx = startIdx;
    msg.sliceLen = this._sliceLen;

    let resp = await browser.runtime.sendNativeMessage(aeConst.DRIVE_CONNECTOR_SVC_APP_NAME, msg);
    let rdgList = resp.syncData;
    this._refreshAccessToken(resp);

    while (resp.hasMoreItems) {
      startIdx = startIdx + this._sliceLen;
      msg.startIdx = startIdx;
      resp = await browser.runtime.sendNativeMessage(aeConst.DRIVE_CONNECTOR_SVC_APP_NAME, msg);
      rdgList = rdgList.concat(resp.syncData);
      this._refreshAccessToken(resp);
    }

    rv = rdgList;
    return rv;
  }

  async setSyncData(aLocalData)
  {
    let rv;
    let msg = this._getNativeMsgReq();
    msg.id = "set-sync-data";
    msg.syncData = aLocalData;

    let resp = await browser.runtime.sendNativeMessage(aeConst.DRIVE_CONNECTOR_SVC_APP_NAME, msg);

    rv = new Date(resp.fileModifiedTime);
    this._refreshAccessToken(resp);

    return rv;
  }

  async getLastModifiedTime()
  {
    if (! this._syncFileID) {
      throw new ReferenceError("Google Drive sync file ID not initialized");
    }
    
    let rv;
    let msg = this._getNativeMsgReq();
    msg.id = "get-last-modified-time";

    let resp = await browser.runtime.sendNativeMessage(aeConst.DRIVE_CONNECTOR_SVC_APP_NAME, msg);
    
    rv = new Date(resp.lastModifiedTime);
    this._refreshAccessToken(resp);

    return rv;
  }


  //
  // Helper methods
  //

  _getNativeMsgReq()
  {
    let rv = {
      accessToken: this._oauthClient.accessToken,
      refreshToken: this._oauthClient.accessToken,
      syncFileID: this._syncFileID,
    };

    return rv;
  }
  
  async _refreshAccessToken(aResponse)
  {
    let rv = null;
    
    if (! ("newAccessToken" in aResponse)) {
      return rv;
    }
    
    let newAccessToken = aResponse.newAccessToken;
    this._oauthClient.accessToken = newAccessToken;
    await aePrefs.setPrefs({accessToken: newAccessToken});
    rv = newAccessToken;

    this._log("aeGoogleDrive._refreshAccessToken(): " + newAccessToken);

    return rv;
  }
}
