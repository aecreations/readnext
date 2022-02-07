/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeOneDrive extends aeAbstractFileHost
{
  AUTHZ_SRV_KEY = "onedrive";  
  

  constructor(aOAuthClient)
  {
    super(aOAuthClient);
  }

  async syncFileExists()
  {
    let rv;
    let resp = await this._getSyncFile();
    
    if (resp.ok) {
      let respBody = await resp.json();
      rv = (respBody.name == this.SYNC_FILENAME
            && respBody.file.mimeType == this.SYNC_FILE_MIME_TYPE);
    }
    else if (resp.status == aeConst.HTTP_STATUS_NOT_FOUND) {
      rv = false;
    }
    else {
      throw new Error(`OneDrive::getItem: ${resp.status} - ${resp.statusText}`);
    }
    
    return rv;
  }

  async createSyncFile(aLocalData)
  {
    let rv = await this._setSyncData(aLocalData);

    return rv;
  }

  async getSyncData()
  {
    let rv;
    let headers = this._getReqHdrs();
    let reqOpts = {
      method: "GET",
      headers,
    };   
    let resp = await this._fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${this.SYNC_FILENAME}:/content`, reqOpts);

    if (resp.status >= 400) {
      throw new Error(`OneDrive::downloadFile: status: ${resp.status} - ${resp.statusText}`);
    }

    rv = await resp.json();

    return rv;
  }

  async setSyncData(aLocalData)
  {
    let rv = await this._setSyncData(aLocalData);

    return rv;
  }

  async getLastModifiedTime()
  {
    let rv;
    let resp = await this._getSyncFile();

    if (resp.ok) {
      let respBody = await resp.json();
      rv = new Date(respBody.lastModifiedDateTime);
    }
    else {
      throw new Error(`OneDrive::getItem: ${resp.status} - ${resp.statusText}`);
    }

    return rv;
  }


  //
  // Helper methods
  //

  async _getSyncFile()
  {
    let rv;
    let headers = this._getReqHdrs();
    let reqOpts = {
      method: "GET",
      headers,
    };   

    rv = await this._fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${this.SYNC_FILENAME}`, reqOpts);

    return rv;
  }

  async _setSyncData(aLocalData)
  {
    let rv;
    let headers = this._getReqHdrs();
    headers.append("Content-Type", this.SYNC_FILE_MIME_TYPE);

    let reqOpts = {
      method: "PUT",
      headers,
      body: JSON.stringify(aLocalData),
    };
    let resp = await this._fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${this.SYNC_FILENAME}:/content`, reqOpts);

    if (! resp.ok) {
      throw new Error(`OneDrive::upload: status: ${resp.status} - ${resp.statusText}`);
    }

    let respBody = await resp.json();
    rv = new Date(respBody.lastModifiedDateTime);

    return rv;  
  }

  _getReqHdrs()
  {
    let rv;
    let headers = new Headers();
    headers.append("Authorization", `Bearer ${this._oauthClient.accessToken}`);
    rv = headers;

    return rv;
  }

  async _fetch(aResource, aInit, aIsRetry)
  {
    let rv, resp;
    
    try {
      resp = await fetch(aResource, aInit);
    }
    catch (e) {
      console.error("aeOneDrive._fetch(): " + e);
      throw e;
    }

    if (resp.ok) {
      rv = resp;
    }
    else {
      this._warn(`aeOneDrive._fetch(): ${resp.status} ${resp.statusText}`);

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

          this._log("aeDropbox._fetch(): Retrying fetch: " + aResource);
          this._log(init);

          rv = await this._fetch(aResource, init, true);
        }
      }
    }

    return rv;
  }

  async _refreshAccessToken()
  {
    // TO DO: Consider putting this helper method in the superclass.
    let rv;
    let params = new URLSearchParams({
      stgsvc: this.AUTHZ_SRV_KEY,
      grant_type: "refresh_token",
      refresh_token: this._oauthClient.refreshToken,
    });
    let reqOpts = {
      method: "POST",
      body: params,
    };
    
    let resp;
    try {
      resp = await fetch("https://aeoaps.herokuapp.com/readnext/token", reqOpts);
    }
    catch (e) {
      console.error("aeOneDrive._refreshAccessToken(): Error getting new access token: " + e);
      throw e;
    }
    
    if (! resp.ok) {
      throw new Error(`Error from aeOAPS /token: status: ${resp.status} - ${resp.statusText}`);
    }
    
    let respBody = await resp.json();
    let newAccessToken = respBody["access_token"];
    let updatedPrefs = {
      accessToken: newAccessToken,
    };
    this._oauthClient.accessToken = newAccessToken;

    // A new refresh token may be issued by authz server.
    if ("refresh_token" in respBody) {
      let newRefreshToken = respBody["refresh_token"];
      this._oauthClient.refreshToken = newRefreshToken;
      updatedPrefs.refreshToken = newRefreshToken;
    }
    
    await aePrefs.setPrefs(updatedPrefs);
    rv = newAccessToken;

    this._log("aeOneDrive._refreshAccessToken(): " + newAccessToken);

    return rv;
  }

  _updateFetchArgs(aInit, aAccessToken)
  {
    let rv = aInit;
    let headers = new Headers(aInit.headers);
    if (headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${aAccessToken}`);
      rv.headers = headers;
    }

    return rv;
  }
}
