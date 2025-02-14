/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const aeConst = Object.freeze({
  DEBUG: true,
  CURR_MAJOR_VER: "1.5",

  FILEHOST_DROPBOX: 1,
  FILEHOST_GOOGLE_DRIVE: 2,
  FILEHOST_ONEDRIVE: 3,

  SYNC_INTERVAL_MINS: 10,
  DCS_READING_LIST_SLICE_LENGTH: 4,

  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_UNAUTHORIZED: 401,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_CONFLICT: 409,

  VER_UPDATE_TYPE_MAJOR: 1,
  VER_UPDATE_TYPE_MINOR: 2,
  POST_UPGRADE_NOTIFCN_DELAY_MS: 60000, // 1 minute
  MSGBAR_DELAY_MS: 15000,

  DEFAULT_FAVICON: "../img/defaultFavicon.svg",
  DEFAULT_FAVICON_DK: "../img/defaultFavicon-dk.svg",
  FAVICON_LOAD_RETRY_DELAY_MS: 1000,

  OPEN_LINK_IN_CURRENT_TAB: 0,
  OPEN_LINK_IN_NEW_TAB: 1,

  AMO_URL: "https://addons.mozilla.org/firefox/addon/readnext/",
  BLOG_URL: "https://aecreations.blogspot.com/",
  FORUM_URL: "https://aecreations.io/forums",
  DONATE_URL: "https://www.paypal.com/paypalme/aecreations88/4.99cad",
  L10N_URL: "https://crowdin.com/project/readnext",
});
