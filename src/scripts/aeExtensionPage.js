/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let aeExtensionPage = function ()
{
  //
  // Private member variables and methods
  //

  let _chooserElts = [];

  function _gotoURL(aURL)
  {
    browser.tabs.create({url: aURL});
  }
  

  //
  // Public methods
  //

  return {
    init(aOSName)
    {
      document.body.dataset.os = aOSName;

      let lang = browser.i18n.getUILanguage();
      document.body.dataset.locale = lang;

      // Suppress context menu.
      document.addEventListener("contextmenu", aEvent => {
	if (aEvent.target.tagName != "INPUT" && aEvent.target.getAttribute("type") != "text") {
	  aEvent.preventDefault();
	}
      });
    },


    getSearchParam(aName)
    {
      let rv;
      let url = new URL(window.location.href);
      rv = url.searchParams.get(aName);

      return rv;
    },
    

    initLinkHandlers(aLinkSelector="a")
    {
      let linkElts = document.querySelectorAll(aLinkSelector);
      for (let link of linkElts) {
	link.addEventListener("click", aEvent => {
	  aEvent.preventDefault();
	  _gotoURL(aEvent.target.href);
	});
      }
    },


    addChooser(aChooserElt)
    {
      if (!(aChooserElt instanceof aeChooser)) {
	throw new TypeError("Argument passed to aeExtensionPage.addChooser() not an instance of aeChooser");
      }

      _chooserElts.push(aChooserElt);
    },


    initChooserHandlers()
    {
      if (_chooserElts.length == 0) {
	return;
      }

      // For aeChooser elements, handle the "mouseup" event in the document
      // in case the user releases the mouse button while dragging outside the
      // chooser UI. Only one chooser on the page can be active at a time.
      document.addEventListener("mouseup", aEvent => {
	if (aEvent.button != 0) {
          return;
	}

	for (let chooser of _chooserElts) {
	  if (chooser._clickedElt) {
            let deselectedElt = chooser._chooserElt.querySelector(`input[type="radio"].deselect`);
            deselectedElt?.classList.remove("deselect");
            chooser._clickedElt.classList.remove("select");
            chooser._clickedElt = null;
	  }
	}
      });      
    },
  };
}();
