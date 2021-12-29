/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeDropbox extends aeAbstractFileHost
{
  ROOT_APP_FOLDER = "";

  
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

  async createSyncFile(aData)
  {
    let rv;
    
    let query = this._getURLParams();
    let headers = this._getReqHdrs();
    let params = {
      path: `/${this.SYNC_FILENAME}`,
      mode: "add",
      mute: true,
    };
    query += "&arg=" + encodeURIComponent(JSON.stringify(params));
    
    let reqOpts = {
      method: "POST",
      headers,
      body: JSON.stringify(aData),
    };
    let resp = await this._fetch(`https://content.dropboxapi.com/2/files/upload?${query}`, reqOpts);

    if (! resp.ok) {
      throw new Error(`Dropbox /files/upload: status: ${resp.status} - ${resp.statusText}`);
    }

    rv = await resp.json();

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


  //
  // Helper methods
  //
  
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

  async _fetch(aResource, aInit)
  {
    let rv;
    
    try {
      rv = await fetch(aResource, aInit);
    }
    catch (e) {
      console.error("aeDropbox._fetch(): " + e);
      throw e;
    }

    // TO DO: Check for failure due to expired access token.
    // If access token is expired, obtain a refresh token and retry.

    return rv;
  }
}
