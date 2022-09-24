/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeBookmark
{
  constructor(aID, aURL, aTitle) {
    this.id = aID;
    this.url = aURL;
    this.title = aTitle;
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
    this.unread = true;
    this.readerMode = false;
  }
};
