/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let aeOAuth = function ()
{
  const GOOGDRV_SCOPES = "https://www.googleapis.com/auth/drive.file";
  
  let _redirectURL;
  let _redirectURLFromOAuth;
  let _authzCode;
  let _accessToken;
  let _refreshToken;
  let _authzSrvKey;
  let _authzSrv = {
    dropbox: {
      authzURL: `https://www.dropbox.com/oauth2/authorize?client_id=%k&redirect_uri=%r&response_type=code&token_access_type=offline&state=%s`,
    },
    onedrive: {
      authzURL: `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=%k&redirect_uri=%r&response_type=code&scope=User.Read+Files.ReadWrite.AppFolder+offline_access&response_mode=query&state=%s`,
    },
    googledrive: {
      authzURL: `https://accounts.google.com/o/oauth2/v2/auth?client_id=%k&redirect_uri=%r&response_type=code&scope=${encodeURIComponent(GOOGDRV_SCOPES)}%20https%3A//www.googleapis.com/auth/userinfo.email&include_granted_scopes=true&access_type=offline&prompt=consent&state=%s`,
    },
  };


  //
  // Public methods
  //

  return {
    init(aAuthzSrv)
    {
      if (aAuthzSrv == aeConst.FILEHOST_DROPBOX) {
        _authzSrvKey = "dropbox";
      }
      else if (aAuthzSrv == aeConst.FILEHOST_ONEDRIVE) {
        _authzSrvKey = "onedrive";
      }
      else if (aAuthzSrv == aeConst.FILEHOST_GOOGLE_DRIVE) {
        _authzSrvKey = "googledrive";
      }

      let redirURL = browser.identity.getRedirectURL(); 
      let subdomain = redirURL.substring(8, redirURL.indexOf("."));
      _redirectURL = `http://127.0.0.1/mozoauth2/${subdomain}`;
    },


    async getAPIKey()
    {
      let rv;
      
      let resp;
      try {
        resp = await fetch(`https://aecreations-oauth.up.railway.app/readnext/apikey?svc=${_authzSrvKey}`);
      }
      catch (e) {
        console.error("aeOAuth.getAPIKey(): Error calling OAPS /readnext/apikey: " + e);
        throw e;        
      }

      let respBody = await resp.json();
      if (! resp.ok) {
        console.error(`Read Next::aeOAuth.js: aeOAuth.getAPIKey(): HTTP error response returned from aeOAPS\nStatus: ${resp.status} - ${resp.statusText}\nDetails:`);
        console.error(respBody);

        throw new Error(`Failed to get client ID from aeOAPS\nStatus: ${resp.status} - ${resp.statusText}`);
      }

      rv = respBody["api_key"];

      return rv;
    },
    

    async getAuthorizationCode()
    {
      let rv;
      let csrfTok;

      if (! _authzSrvKey) {
        throw new ReferenceError("Authorization service not defined");
      }

      let apiKey;
      try {
        apiKey = await this.getAPIKey();
      }
      catch (e) {
        console.error("aeOAuth.getAuthorizationCode(): " + e);
        throw e;
      }

      let authzURL = _authzSrv[_authzSrvKey].authzURL;
      authzURL = authzURL.replace("%k", apiKey);
      authzURL = authzURL.replace("%r", _redirectURL);

      // Add state parameter to guard against CSRF attacks.
      let uia = new Uint32Array(1);
      crypto.getRandomValues(uia);
      csrfTok = md5(uia[0]);
      authzURL = authzURL.replace("%s", csrfTok);

      let webAuthPpty = {
        url: authzURL,
        interactive: true
      };

      try {
        _redirectURLFromOAuth = await browser.identity.launchWebAuthFlow(webAuthPpty);
      }
      catch (e) {
        console.error("aeOAuth.getAuthorizationCode(): " + e);
        throw e;
      }

      let redirURL = new URL(_redirectURLFromOAuth);
      let stateParam = redirURL.searchParams.get("state");
      if (stateParam != csrfTok) {
        throw new RangeError("aeOAuth.getAuthorizationCode(): CSRF token mismatch!");
      }
      
      rv = _authzCode = redirURL.searchParams.get("code");
      return rv;
    },


    async getAccessToken()
    {
      let rv;

      if (! _authzCode) {
        throw new ReferenceError("Authorization code not defined");
      }

      let requestParams = new URLSearchParams({
        svc: _authzSrvKey,
        grant_type: "authorization_code",
        code: _authzCode,
        redirect_uri: _redirectURL,
      });
      let requestOpts = {
        method: "POST",
        body: requestParams,
      };

      let resp;  
      try {
        resp = await fetch("https://aecreations-oauth.up.railway.app/readnext/token", requestOpts);
      }
      catch (e) {
        console.error("aeOAuth.getAccessToken(): Error getting access token: " + e);
        throw e;
      }
  
      if (! resp.ok) {
        throw new Error(`failed to get access token from ${_authzSrvKey}\n\nstatus: ${resp.status} - ${resp.statusText}`);
      }
  
      let respBody = await resp.json();

      // Google Drive: Check that all required permissions were granted.
      if (_authzSrvKey == "googledrive") {
        let scope = respBody["scope"];
        if (!scope.includes(GOOGDRV_SCOPES)) {
          // Save access token so that it can be used in revoke API call.
          _accessToken = respBody["access_token"];
          throw new aeAuthorizationError("Insufficient permissions granted for Google Drive");
        }
      }

      _accessToken = respBody["access_token"];
      _refreshToken = respBody["refresh_token"];
      rv = {
        accessToken: _accessToken,
        refreshToken: _refreshToken,
      };

      return rv;
    },


    // Google Drive only
    async revokeAccessToken()
    {
      if (!_authzSrvKey) {
        throw new ReferenceError("Authorization service not defined");
      }
      if (_authzSrvKey != "googledrive") {
        throw new Error("Access token revocation not supported");
      }

      let headers = new Headers({"Content-Type": "application/x-www-form-urlencoded"});
      let reqOpts = {
        method: "POST",
        headers,
      };

      let resp;
      try {
        resp = await fetch(`https://oauth2.googleapis.com/revoke?token=${_accessToken}`, reqOpts);
      }
      catch (e) {
        console.error("aeOAuth.revokeAccessToken(): " + e);
        throw e;
      }

      _accessToken = null;

      if (!resp.ok) {
        throw new Error(`Failed to revoke access token from ${_authzSrvKey}\n\nstatus: ${resp.status} - ${resp.statusText}`);
      }
    },
  };
}();
