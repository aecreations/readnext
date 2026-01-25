/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeChooser
{
  constructor(aChooserEltSelector)
  {
    this._chooserElt = document.querySelector(`${aChooserEltSelector}`);
    this._chooserEltStor = aChooserEltSelector;
    this._clickedElt = null;
    this._fnClick = function (aEvent) {};

    if (!this._chooserElt) {
      throw new ReferenceError(`aeChooser: Selector "${aChooserEltSelector}" doesn't refer to a valid DOM element`);
    }

    this._chooserElt.addEventListener("mousedown", aEvent => {
      if (aEvent.button != 0) {
        return;
      }

      let inputElt;
      if (aEvent.target.tagName == "INPUT") {
        inputElt = aEvent.target;
      }
      else if (aEvent.target.tagName == "LABEL") {
        inputElt = aEvent.target.previousElementSibling;
      }
      else {
        return;
      }

      let selectedElt = this._chooserElt.querySelector(`input[type="radio"]:checked`);
      // Don't apply the deselect state if clicking on an icon that is
      // already selected.
      if (selectedElt && selectedElt.id != inputElt.id) {
        selectedElt.classList.add("deselect");
      }
      inputElt.classList.add("select");
      this._clickedElt = inputElt;
    });

    this._chooserElt.addEventListener("mouseup", aEvent => {
      if (aEvent.button != 0) {
        return;
      }

      let inputElt;
      if (aEvent.target.tagName == "INPUT") {
        inputElt = aEvent.target;
      }
      else if (aEvent.target.tagName == "LABEL") {
        inputElt = aEvent.target.previousElementSibling;
      }
      else {
        return;
      }

      let deselectedElt = this._chooserElt.querySelector(`input[type="radio"].deselect`);
      inputElt.classList.remove("select");
      deselectedElt?.classList.remove("deselect");
      this._clickedElt = null;
    });

    // Also handle the "mouseup" event in the document in case the user
    // releases the mouse button while dragging outside the chooser UI.
    document.addEventListener("mouseup", aEvent => {
      if (aEvent.button != 0) {
        return;
      }

      if (this._clickedElt) {
        let deselectedElt = this._chooserElt.querySelector(`input[type="radio"].deselect`);

        deselectedElt?.classList.remove("deselect");
        this._clickedElt.classList.remove("select");
        this._clickedElt = null;
      }
    });

    // Click event handler for each item in the chooser.
    let radioBtns = this._chooserElt.querySelectorAll(`input[type="radio"]`);
    for (let btn of radioBtns) {
      btn.addEventListener("click", aEvent => {
	this._fnClick(aEvent);
      });
    }
  }


  set onClick(aFnClick)
  {
    this._fnClick = aFnClick;
  }
}
