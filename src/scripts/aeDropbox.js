/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeDropbox extends aeAbstractFileHost
{
  AUTHZ_SRV_KEY = "dropbox";
  ROOT_APP_FOLDER = "";
  HTTP_STATUS_UNAUTHORIZED = 401;
  

  constructor(aOAuthClient)
  {
    super(aOAuthClient);
  }

  async syncFileExists()
  {
    let rv;
    let query = this._getURLParams();
    let headers = this._getReqHdrs();
    let params = {
      path: this.ROOT_APP_FOLDER,
      recursive: false,
    };
    let reqOpts = {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    };   
    let resp = await this._fetch(`https://api.dropboxapi.com/2/files/list_folder?${query}`, reqOpts);

    if (! resp.ok) {
      throw new Error(`Dropbox /files/list_folder: status: ${resp.status} - ${resp.statusText}`);
    }

    let parsedResp = await resp.json();
    if (parsedResp.entries.length == 0) {
      rv = false;
    }
    else {
      let idx = parsedResp.entries.findIndex(aItem => {
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
    let query = this._getURLParams();
    let params = {path: `/${this.SYNC_FILENAME}`};
    query += "&arg=" + encodeURIComponent(JSON.stringify(params));

    let reqOpts = {method: "POST"};
    let resp = await this._fetch(`https://content.dropboxapi.com/2/files/download?${query}`, reqOpts);

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

    // The /files/get_metadata endpoint doesn't seem to allow suppression of
    // the CORS pre-flight check.
    let headers = new Headers();
    headers.append("Authorization", `Bearer ${this._oauthClient.accessToken}`);
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

    let parsedResp = await resp.json();   
    rv = new Date(parsedResp.server_modified);

    return rv;
  }


  //
  // Helper methods
  //
  
  async _setSyncData(aLocalData, aOverwrite)
  {
    let rv;
    let query = this._getURLParams();
    let headers = this._getReqHdrs();
    let params = {
      path: `/${this.SYNC_FILENAME}`,
      mode: aOverwrite ? "overwrite" : "add",
      mute: true,
    };
    query += "&arg=" + encodeURIComponent(JSON.stringify(params));
    
    let reqOpts = {
      method: "POST",
      headers,
      body: JSON.stringify(aLocalData),
    };
    let resp = await this._fetch(`https://content.dropboxapi.com/2/files/upload?${query}`, reqOpts);

    if (! resp.ok) {
      throw new Error(`Dropbox /files/upload: status: ${resp.status} - ${resp.statusText}`);
    }

    let parsedResp = await resp.json();
    rv = new Date(parsedResp.server_modified);

    return rv;
  }
  
  _getURLParams()
  {
    // Requests to Dropbox should be simple cross-site request to suppress
    // pre-flight checks.
    let rv = `authorization=Bearer ${this._oauthClient.accessToken}&reject_cors_preflight=true`;
    return rv;
  }

  _getReqHdrs()
  {
    let rv;

    // Requests to Dropbox should be simple cross-site requests to suppress
    // pre-flight checks.
    let headers = new Headers();
    headers.append("Content-Type", "text/plain; charset=dropbox-cors-hack");
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
      console.error("aeDropbox._fetch(): " + e);
      throw e;
    }

    if (resp.ok) {
      rv = resp;
    }
    else {
      this._warn(`aeDropbox._fetch(): ${resp.status} ${resp.statusText}`);

      if (resp.status == this.HTTP_STATUS_UNAUTHORIZED) {
        if (aIsRetry) {
          // Prevent infinite recursion and just return the error response.
          rv = resp;
        }
        else {
          this._log("Access token may have expired.  Refreshing access token...");
          
          // Update parameters to fetch call with new access token.
          let newAccessToken = await this._refreshAccessToken();
          let {resource, init} = this._updateFetchArgs(aResource, aInit, newAccessToken);

          this._log("aeDropbox._fetch(): Retrying fetch with URL: " + resource);
          this._log(init);

          rv = await this._fetch(resource, init, true);
        }
      }
    }

    return rv;
  }

  async _refreshAccessToken()
  {
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
      console.error("aeDropbox._refreshAccessToken(): Error getting new access token: " + e);
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

    this._log("aeDropbox._refreshAccessToken(): " + newAccessToken);

    return rv;
  }

  _updateFetchArgs(aResource, aInit, aAccessToken)
  {
    let rv = {
      resource: aResource,
      init: aInit,
    };
    
    let url = new URL(aResource);
    let srchParams = url.searchParams;

    // Update query string with new access token.
    if (srchParams.has("reject_cors_preflight")) {
      let query = `?authorization=Bearer ${aAccessToken}&reject_cors_preflight=true`;
      if (srchParams.has("arg")) {
        query += "&arg=" + srchParams.get("arg");
      }
      rv.resource = url.origin + url.pathname + query;
    }
    else {
      // If suppression of CORS pre-flight check is not supported, then update
      // the 'Authorization' header in the request.
      let headers = new Headers(aInit.headers);
      if (headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${aAccessToken}`);
        rv.init.headers = headers;
      }
    }

    return rv;
  }
}
