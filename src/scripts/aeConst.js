/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let aeConst = {
  DEBUG: true,
  EXTENSION_ID: "readnext@aecreations.github.io",

  FILEHOST_DROPBOX: 1,
  FILEHOST_GOOGLE_DRIVE: 2,
  FILEHOST_ONEDRIVE: 3,

  SYNC_INTERVAL_MINS: 10,
  DCS_READING_LIST_SLICE_LENGTH: 4,

  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_UNAUTHORIZED: 401,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_CONFLICT: 409,

  // Native messaging helper app
  DRIVE_CONNECTOR_SVC_APP_NAME: "driveConnectorSvc",

  DEFAULT_FAVICON: "chrome://global/skin/icons/defaultFavicon.svg",
  FAVICON_LOAD_RETRY_DELAY_MS: 1000,

  DRIVE_CONN_SVC_DOWNLOAD_URL: "https://aecreations.io/readnext/drive-connector-service.php",
};
