/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


let gWndID, gTabID;


function sanitizeHTML(aHTMLStr)
{
  return DOMPurify.sanitize(aHTMLStr, {SAFE_FOR_JQUERY: true});
}


// Page initialization
$(async () => {
  let extInfo = browser.runtime.getManifest();
  let contribCTA = browser.i18n.getMessage("contribCTA", aeConst.DONATE_URL);
  
  $("#ver-subhead").text(browser.i18n.getMessage("aboutExtVer", aeConst.CURR_MAJOR_VER));
  $("#contrib-cta").html(sanitizeHTML(contribCTA));
  
  $("#link-website > a").attr("href", extInfo.homepage_url);
  $("#link-amo > a").attr("href", aeConst.AMO_URL);
  $("#link-blog > a").attr("href", aeConst.BLOG_URL);
  $("#link-forum > a").attr("href", aeConst.FORUM_URL);

  $("#btn-close").on("click", async (aEvent) => { closePage() });

  $("a").on("click", aEvent => {
    aEvent.preventDefault();
    gotoURL(aEvent.target.href);
  });

  let [currWnd, tabs] = await Promise.all([
    browser.windows.getCurrent(),
    browser.tabs.query({active: true, currentWindow: true}),
  ]);
  gWndID = currWnd.id;
  gTabID = tabs[0].id;

  browser.runtime.sendMessage({id: "whats-new-pg-opened"});
});


function gotoURL(aURL)
{
  browser.tabs.create({url: aURL});
}


async function closePage()
{
  let tab = await browser.tabs.getCurrent();
  browser.tabs.remove(tab.id);
}


//
// Event handlers
//

browser.runtime.onMessage.addListener(aMessage => {
  if (aMessage.id == "ping-whats-new-pg") {
    let resp = {
      wndID: gWndID,
      tabID: gTabID,
    };
    return Promise.resolve(resp);
  }
});


$(window).on("contextmenu", aEvent => {
  if (aEvent.target.tagName != "INPUT" && aEvent.target.getAttribute("type") != "text") {
    aEvent.preventDefault();
  }
});
