/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeAbstractFileHost
{
  SYNC_FILENAME = "readnext.json";
  
  _oauthClient = null;
  

  constructor(aOAuthClient)
  {
    if (! (aOAuthClient instanceof aeOAuthClient)) {
      throw new TypeError("aOAuthClient not an aeOAuthClient");
    }
    
    this._oauthClient = aOAuthClient;
  }

  async createSyncFile(aLocalData) { throw new Error("Abstract method") }

  async syncFileExists() { throw new Error("Abstract method") }

  async getSyncData() { throw new Error("Abstract method") }

  async setSyncData(aLocalData) { throw new Error("Abstract method") }

  async getLastModifiedTime() { throw new Error("Abstract method") }
}
