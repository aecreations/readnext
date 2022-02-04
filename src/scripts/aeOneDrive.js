/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeOneDrive extends aeAbstractFileHost
{
  AUTHZ_SRV_KEY = "onedrive";
  HTTP_STATUS_NOT_FOUND = 404;
  

  constructor(aOAuthClient)
  {
    super(aOAuthClient);
  }

  async syncFileExists()
  {
    let rv;
    let resp = await this._getSyncFile();
    
    if (resp.ok) {
      let parsedResp = await resp.json();
      rv = (parsedResp.name == this.SYNC_FILENAME
            && parsedResp.file.mimeType == this.SYNC_FILE_MIME_TYPE);
    }
    else if (resp.status == this.HTTP_STATUS_NOT_FOUND) {
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
      let parsedResp = await resp.json();
      rv = new Date(parsedResp.lastModifiedDateTime);
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

    let parsedResp = await resp.json();
    rv = new Date(parsedResp.lastModifiedDateTime);

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

      // TO DO: Handle expired access token.
      // Get new access token from refresh token and then retry fetch call.
      rv = resp;
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
      resp = await fetch("https://aeoaps.herokuapp.com/readnext/authtoken", reqOpts);
    }
    catch (e) {
      console.error("aeOneDrive._refreshAccessToken(): Error getting new access token: " + e);
      throw e;
    }
    
    if (! resp.ok) {
      throw new Error(`Error from aeOAPS /authtoken: status: ${resp.status} - ${resp.statusText}`);
    }
    
    let parsedResp = await resp.json();
    let newAccessToken = parsedResp["access_token"];
    this._oauthClient.accessToken = newAccessToken;
    await aePrefs.setPrefs({accessToken: newAccessToken});
    rv = newAccessToken;

    this._log("aeOneDrive._refreshAccessToken(): " + newAccessToken);

    return rv;
  }
}
