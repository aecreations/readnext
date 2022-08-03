/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


function aeFileHostUI(aFileHostID)
{
  let rv;
  let backnd = Number(aFileHostID);

  switch (backnd) {
  case aeConst.FILEHOST_DROPBOX:
    rv = {
      fileHostName: browser.i18n.getMessage("fhDropbox"),
      iconPath: "../img/dropbox.svg",
    };
    break;

  case aeConst.FILEHOST_GOOGLE_DRIVE:
    rv = {
      fileHostName: browser.i18n.getMessage("fhGoogleDrive"),
      iconPath: "../img/googledrive.svg",
    };
    break;

  case aeConst.FILEHOST_ONEDRIVE:
    rv = {
      fileHostName: browser.i18n.getMessage("fhOneDrive"),
      iconPath: "../img/onedrive.svg",
    };
    break;

  default:
    break;
  }

  return rv;
}
