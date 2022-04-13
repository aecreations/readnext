/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeDropbox extends aeAbstractFileHost
{
  AUTHZ_SRV_KEY = "dropbox";
  ROOT_APP_FOLDER = "";
  

  constructor(aOAuthClient)
  {
    super(aOAuthClient);
  }

  async syncFileExists()
  {
    let rv;
    let params = {
      path: this.ROOT_APP_FOLDER,
      recursive: false,
    };
    let headers = this._getReqHdrs();
    headers.append("Content-Type", "application/json");

    let reqOpts = {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    };   
    let resp = await this._fetch(`https://api.dropboxapi.com/2/files/list_folder`, reqOpts);

    if (! resp.ok) {
      throw new Error(`Dropbox /files/list_folder: status: ${resp.status} - ${resp.statusText}`);
    }

    let respBody = await resp.json();
    if (respBody.entries.length == 0) {
      rv = false;
    }
    else {
      let idx = respBody.entries.findIndex(aItem => {
        return (aItem.name == this.SYNC_FILENAME && aItem[".tag"] == "file");
      });

      rv = idx != -1;
    }

    return rv;
  }

  async createSyncFile(aLocalData)
  {
    let rv = await this._setSyncData(aLocalData, false);
    
    return rv;
  }

  async getSyncData()
  {
    let rv;
    let params = {path: `/${this.SYNC_FILENAME}`};
    let headers = this._getReqHdrs();
    headers.append("Dropbox-API-Arg", this._encodeJSON(JSON.stringify(params)));

    let reqOpts = {
      method: "POST",
      headers,
    };
    let resp = await this._fetch(`https://content.dropboxapi.com/2/files/download`, reqOpts);

    if (! resp.ok) {
      throw new Error(`Dropbox /files/download: status: ${resp.status} - ${resp.statusText}`);
    }

    rv = await resp.json();

    return rv;
  }

  async setSyncData(aLocalData)
  {
    let rv = await this._setSyncData(aLocalData, true);

    return rv;
  }

  async getLastModifiedTime()
  {
    let rv;
    let headers = this._getReqHdrs();
    headers.append("Content-Type", "application/json");

    let params = {path: `/${this.SYNC_FILENAME}`};
    let reqOpts = {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    };
    let resp = await this._fetch(`https://api.dropboxapi.com/2/files/get_metadata`, reqOpts);

    if (! resp.ok) {
      throw new Error(`Dropbox /files/get_metadata: status: ${resp.status} - ${resp.statusText}`);
    }

    let respBody = await resp.json();   
    rv = new Date(respBody.server_modified);

    return rv;
  }


  //
  // Helper methods
  //
  
  async _setSyncData(aLocalData, aOverwrite)
  {
    let rv;
    let params = {
      path: `/${this.SYNC_FILENAME}`,
      mode: aOverwrite ? "overwrite" : "add",
      mute: true,
    };
    let headers = this._getReqHdrs();
    headers.append("Content-Type", "application/octet-stream");
    headers.append("Dropbox-API-Arg", this._encodeJSON(JSON.stringify(params)));
    
    let reqOpts = {
      method: "POST",
      headers,
      body: JSON.stringify(aLocalData),
    };
    let resp = await this._fetch(`https://content.dropboxapi.com/2/files/upload`, reqOpts);

    if (! resp.ok) {
      throw new Error(`Dropbox /files/upload: status: ${resp.status} - ${resp.statusText}`);
    }

    let respBody = await resp.json();
    rv = new Date(respBody.server_modified);

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

  _encodeJSON(aJSONStr)
  {
    let rv;
    let charsToEncode = /[\u007f-\uffff]/g;
    rv = aJSONStr.replace(charsToEncode, function (c) {
      return '\\u'+('000'+c.charCodeAt(0).toString(16)).slice(-4);
    });

    return rv;
  }

  async _fetch(aResource, aInit, aIsRetry)
  {
    let rv, resp;
    
    try {
      resp = await fetch(aResource, aInit);
    }
    catch (e) {
      console.error("aeDropbox._fetch(): " + e);
      throw e;
    }

    if (resp.ok) {
      rv = resp;
    }
    else {
      this._warn(`aeDropbox._fetch(): ${resp.status} ${resp.statusText}`);

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

          this._log("aeDropbox._fetch(): Retrying fetch with URL: " + aResource);
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
      resp = await fetch("https://aeoaps.herokuapp.com/readnext/token", reqOpts);
    }
    catch (e) {
      console.error("aeDropbox._refreshAccessToken(): Error getting new access token: " + e);
      throw e;
    }
    
    if (! resp.ok) {
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
    this._oauthClient.accessToken = newAccessToken;
    await aePrefs.setPrefs({accessToken: newAccessToken});
    rv = newAccessToken;

    this._log("aeDropbox._refreshAccessToken(): " + newAccessToken);

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
