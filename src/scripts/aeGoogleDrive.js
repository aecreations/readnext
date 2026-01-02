/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeGoogleDrive extends aeAbstractFileHost
{
  AUTHZ_SRV_KEY = "googledrive";

  // The Google Drive API sets the wrong MIME type on the JSON sync file,
  // ignoring "application/javascript" in the Content-Type header in API calls,
  // so make it consistent (but wrong) here.
  SYNC_FILE_MIME_TYPE = "text/plain";
  
  // Public static constant.
  static AUTHZ_SRV_URL = "https://accounts.google.com/o/oauth2/v2/auth";


  constructor(aOAuthClient)
  {
    super(aOAuthClient);
  }


  async getUsername()
  {
    let rv;
    let headers = this._getReqHdrs();
    let reqOpts = {
      method: "GET",
      headers,
    };
    let resp = await this._fetch("https://www.googleapis.com/drive/v3/about?fields=user", reqOpts);
    let respBody = await resp.json();

    rv = respBody.user.emailAddress;

    return rv;
  }


  async syncFileExists()
  {
    let rv = false;
    let headers = this._getReqHdrs();
    let reqOpts = {
      method: "GET",
      headers,
    };
    let q = "spaces=appDataFolder&fields=files(id,name,mimeType,size,modifiedTime)";
    let resp = await this._fetch(`https://www.googleapis.com/drive/v3/files?${q}`, reqOpts);
    
    if (resp.ok) {
      let respBody = await resp.json();
      if (respBody.files instanceof Array && respBody.files.length > 0) {
	let files = respBody.files.filter(aFile => aFile.name == this.SYNC_FILENAME
					  && aFile.mimeType == this.SYNC_FILE_MIME_TYPE);
	if (files.length > 0) {
	  rv = true;
	  let syncFileID = files[0].id;
	  await aePrefs.setPrefs({syncFileID});
	}
      }
    }
    else if (resp.status == aeConst.HTTP_STATUS_NOT_FOUND) {
      rv = false;
    }
    else {
      throw new Error(`GoogleDrive::files: ${resp.status} - ${resp.statusText}`);
    }

    return rv;
  }


  async createSyncFile(aLocalData)
  {
    let rv;
    let headers = this._getReqHdrs();
    headers["Content-Type"] = this.SYNC_FILE_MIME_TYPE;

    let body = JSON.stringify({
      name: this.SYNC_FILENAME,
      parents: ["appDataFolder"],
    });
    let reqOpts = {
      method: "POST",
      headers,
      body,
    };

    let resp = await this._fetch(`https://content.googleapis.com/drive/v3/files`, reqOpts);

    if (resp.ok) {
      let respBody = await resp.json();
      let syncFileID = respBody.id;
      await aePrefs.setPrefs({syncFileID});

      // Populate the newly-created file with an empty JSON array.
      rv = await this.setSyncData([]);
    }
    else {
      throw new Error(`GoogleDrive::files: ${resp.status} - ${resp.statusText}`);
    }
    
    return rv;
  }


  async getSyncData()
  {
    let syncFileID = await aePrefs.getPref("syncFileID");
    if (!syncFileID) {
      throw new ReferenceError("aeGoogleDrive.getSyncData(): Pref `syncFileID` not set");
    }

    let rv;
    let headers = this._getReqHdrs();
    let reqOpts = {
      method: "GET",
      headers,
    };

    let resp = await this._fetch(`https://www.googleapis.com/drive/v3/files/${syncFileID}?alt=media`, reqOpts);

    if (resp.ok) {
      rv = await resp.json();
    }
    else {
      throw new Error(`GoogleDrive::files: ${resp.status} - ${resp.statusText}`);
    }

    return rv;
  }


  async setSyncData(aLocalData)
  {
    let syncFileID = await aePrefs.getPref("syncFileID");
    if (!syncFileID) {
      throw new ReferenceError("aeGoogleDrive.setSyncData(): Pref `syncFileID` not set");
    }

    let rv;
    let body = JSON.stringify(aLocalData);
    let headers = this._getReqHdrs();
    headers["Content-Type"] = this.SYNC_FILE_MIME_TYPE;
    headers["Content-Length"] = this._getLengthInBytes(body);

    let reqOpts = {
      method: "PATCH",
      headers,
      body,
    };

    let resp = await this._fetch(`https://www.googleapis.com/upload/drive/v3/files/${syncFileID}?uploadType=media`, reqOpts);
    let respBody = await resp.json();
    
    if (resp.ok) {
      // Get the last modified timestamp in UTC.
      rv = await this.getLastModifiedTime();
    }
    else {
      if (resp.status == aeConst.HTTP_STATUS_NOT_FOUND) {
	this._log(`aeGoogleDrive.setSyncData(): API call to /upload/drive/v3/files/${fileIDSfx} returned HTTP status ${resp.status}`); 
      }
      throw new Error(`GoogleDrive::files: ${resp.status} - ${resp.statusText}`);
    }

    return rv;
  }
  

  async getLastModifiedTime()
  {
    let syncFileID = await aePrefs.getPref("syncFileID");
    if (!syncFileID) {
      throw new ReferenceError("aeGoogleDrive.getLastModifiedTime(): Pref `syncFileID` not set");
    }

    let rv;
    let headers = this._getReqHdrs();
    let reqOpts = {
      method: "GET",
      headers,
    };

    let resp = await this._fetch(`https://www.googleapis.com/drive/v3/files/${syncFileID}?fields=modifiedTime`, reqOpts);

    if (resp.ok) {
      let respBody = await resp.json();
      rv = new Date(respBody.modifiedTime);
    }
    else {
      throw new Error(`GoogleDrive::files: ${resp.status} - ${resp.statusText}`);
    }

    return rv;
  }


  //
  // Helper methods
  //

  async _fetch(aResource, aInit, aIsRetry)
  {
    let rv, resp;
    
    try {
      resp = await fetch(aResource, aInit);
    }
    catch (e) {
      console.error("aeGoogleDrive._fetch(): " + e);
      throw e;
    }

    if (resp.ok) {
      rv = resp;
    }
    else {
      this._warn(`aeGoogleDrive._fetch(): ${resp.status} ${resp.statusText}`);

      if (resp.status == aeConst.HTTP_STATUS_UNAUTHORIZED) {
        if (aIsRetry) {
          // Prevent infinite recursion and just return the error response.
          rv = resp;
        }
        else {
          this._log("Access token may have expired.  Refreshing access token...");

          // Update parameters to fetch call with new access token.
          let newAccessToken = await this._refreshAccessToken();
          let init = this._updateFetchArgs(aInit, newAccessToken);

          this._log("aeGoogleDrive._fetch(): Retrying fetch with URL: " + aResource);
          this._log(init);

          rv = await this._fetch(aResource, init, true);
        }
      }
      else {
        rv = resp;
      }
    }

    return rv;
  }


  async _refreshAccessToken()
  {
    let rv;
    let params = new URLSearchParams({
      svc: this.AUTHZ_SRV_KEY,
      grant_type: "refresh_token",
      refresh_token: this._oauthClient.refreshToken,
    });
    let reqOpts = {
      method: "POST",
      body: params,
    };
    
    let resp;
    try {
      resp = await fetch("https://aecreations-oauth.up.railway.app/readnext/token", reqOpts);
    }
    catch (e) {
      console.error("aeGoogleDrive._refreshAccessToken(): Error getting new access token: " + e);
      throw e;
    }
    
    if (!resp.ok) {
      let errRespBody = await resp.json();
      if (resp.status == aeConst.HTTP_STATUS_BAD_REQUEST && "error" in errRespBody
          && errRespBody.error.name == "AuthorizationError") {
        throw new aeAuthorizationError(errRespBody.error.message);
      }
      else {
        throw new Error(`Error from aeOAPS /token: status: ${resp.status} - ${resp.statusText}`);
      }
    }
    
    let respBody = await resp.json();
    let newAccessToken = respBody["access_token"];
    let updatedPrefs = {
      accessToken: newAccessToken,
    };
    this._oauthClient.accessToken = newAccessToken;

    await aePrefs.setPrefs(updatedPrefs);
    rv = newAccessToken;

    this._log("aeGoogleDrive._refreshAccessToken(): " + newAccessToken);

    return rv;
  }
}
