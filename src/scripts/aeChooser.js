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
      throw new ReferenceError(`aeChooser: Selector "${aChooserEltSelector}" doesn't refer to a DOM element`);
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

    // If navigating the chooser with the arrow keys, select the first icon at
    // the beginning of navigation.
    this._chooserElt.addEventListener("keydown", aEvent => {
      if (this.selectedIndex == -1 && ["ArrowRight", "ArrowDown"].includes(aEvent.key)) {
        this.item(0).click();
        aEvent.preventDefault();
      }
    });

    // Click event handler for each item in the chooser.
    let radioBtns = this.options;
    for (let btn of radioBtns) {
      btn.addEventListener("click", aEvent => {
        this._fnClick(aEvent);
      });
    }
  }


  //
  // Properties and methods
  //

  get options() //-> NodeList
  {
    let rv = this._chooserElt.querySelectorAll(`input[type="radio"]`);
    return rv;
  }


  get selectedIndex() //-> Number?
  {
    let rv;
    let inputElts = this.options;
    if (!inputElts) {
      return rv;
    }

    let radioBtns = Array.from(inputElts);
    rv = radioBtns.findIndex(aBtn => aBtn.checked);

    return rv;
  }

  set selectedIndex(aIndex)
  {
    aIndex = parseInt(aIndex);
    if (isNaN(aIndex)) {
      throw new TypeError("aeChooser.selectedIndex: index is not a number");
    }

    let inputElts = this.options;
    if (!inputElts) {
      return;
    }
    if (aIndex > inputElts.length - 1) {
      throw new RangeError("aeChooser.selectedIndex: index out of range");
    }

    // Deselect first. Clear selection if index is -1 or any negative number.
    inputElts.forEach(aRadioBtn => { aRadioBtn.checked = false });
    if (aIndex >= 0) {
      inputElts[aIndex].checked = true;
    }
  }


  get value() //-> String?
  {
    let rv;
    let inputElts = this.options;
    if (!inputElts) {
      return rv;
    }

    let radioBtns = Array.from(inputElts);
    let [selected] = radioBtns.filter(aBtn => aBtn.checked);

    if (selected) {
      rv = selected.value;
    }

    return rv;
  }

  set value(aValue) //-> Boolean
  {
    let rv = false;
    let inputElts = this.options;

    for (let radioBtn of inputElts) {
      if (radioBtn.value == aValue) {
        radioBtn.checked = true;
        rv = true;
      }
      else {
        radioBtn.checked = false;
      }
    }

    return rv;
  }


  item(aIndex) //-> HTMLInputElement?
  {
    aIndex = parseInt(aIndex);
    if (isNaN(aIndex)) {
      throw new TypeError("aeChooser.item(): index is not a number");
    }
    if (aIndex < 0) {
      throw new RangeError("aeChooser.item(): index out of range");
    }

    let rv;
    let inputElts = this.options;
    if (!inputElts) {
      return;
    }
    if (aIndex > inputElts.length - 1) {
      throw new RangeError("aeChooser.item(): index out of range");
    }

    rv = inputElts[aIndex];

    return rv;
  }


  //
  // Event handlers
  //

  set onClick(aFnClick)
  {
    this._fnClick = aFnClick;
  }
}
