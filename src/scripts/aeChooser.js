/* -*- mode: javascript; tab-width: 8; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class aeChooser
{
  constructor(aChooserEltSelector, aDialog=null)
  {
    this._chooserElt = document.querySelector(`${aChooserEltSelector}`);
    if (!this._chooserElt) {
      throw new ReferenceError(`aeChooser: Selector "${aChooserEltSelector}" doesn't refer to a DOM element`);
    }

    if (aDialog !== null && !(aDialog instanceof aeDialog)) {
      throw new TypeError("aeChooser: Optional argument aDialog not an instance of aeDialog");
    }

    this._chooserEltStor = aChooserEltSelector;
    this._hostDlg = aDialog;
    this._fnClick = function (aEvent) {};

    // For deselecting radio button if user releases mouse button outside of
    // the chooser. Handled by aeExtensionPage.
    this._clickedElt = null;

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
      // Make sure selection state is removed on all radio buttons.
      let inputElts = this._chooserElt.querySelectorAll(`input[type="radio"]`);
      for (let elt of inputElts) {
        elt.classList.remove("select");
      }
      deselectedElt?.classList.remove("deselect");
      this._clickedElt = null;

      if (this._hostDlg) {
        this._updateDlgFirstTabStop(inputElt);
      }
    });

    this._chooserElt.addEventListener("keydown", aEvent => {
      // Select the first icon at the beginning of navigation.
      if (this.selectedIndex == -1 && ["ArrowRight", "ArrowDown"].includes(aEvent.key)) {
        this.item(0).click();
        aEvent.preventDefault();
      }
    });

    this._chooserElt.addEventListener("keyup", aEvent => {
      if (this.selectedIndex != -1
          && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(aEvent.key)) {
        // Focus the correct radio button.
        let selectedElt = this._chooserElt.querySelector(`input[type="radio"]:checked`);
        aEvent.target.blur();
        selectedElt.focus();

        if (this._hostDlg) {
          this._updateDlgFirstTabStop(selectedElt);
        }
      }
    });

    let inputElts = this.options;
    for (let elt of inputElts) {
      elt.dataset.chooserId = this._chooserElt.id;

      // Add event handlers for each item in the chooser.
      elt.addEventListener("click", aEvent => {
        this._fnClick(aEvent);
      });
      elt.addEventListener("focus", aEvent => {
        // Element is focused via keyboard.
        if (aEvent.target.matches(":-moz-focusring")) {
          this._chooserElt.classList.add("focus");

          if (!aEvent.target.checked && this.selectedIndex != -1) {
            let selectedElt = this._chooserElt.querySelector(`input[type="radio"]:checked`);
            aEvent.target.blur();
            selectedElt.focus();
          }
        }
      });
      elt.addEventListener("blur", aEvent => {
        let focusTargElt = aEvent.relatedTarget;
        if (focusTargElt && focusTargElt.tagName != "INPUT" && focusTargElt.type != "radio"
            // Handle transitioning of focus between different choosers in the
            // same page or dialog.
            && focusTargElt.name != aEvent.target.name) {
          this._chooserElt.classList.remove("focus");
        }
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
    let rv = null;
    let inputElts = this.options;
    if (inputElts.length == 0) {
      return rv;
    }

    rv = Array.from(inputElts).findIndex(aBtn => aBtn.checked);

    return rv;
  }

  set selectedIndex(aIndex)
  {
    aIndex = parseInt(aIndex);
    if (isNaN(aIndex)) {
      throw new TypeError("aeChooser.selectedIndex: index is not a number");
    }

    let inputElts = this.options;
    if (inputElts.length == 0) {
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
    let rv = null;
    if (this.options.length == 0) {
      return rv;
    }

    let selectedElt = this._chooserElt.querySelector(`input[type="radio"]:checked`);
    if (selectedElt) {
      rv = selectedElt.value;
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

    let rv = null;
    let inputElts = this.options;
    if (inputElts.length == 0) {
      return rv;
    }
    if (aIndex > inputElts.length - 1) {
      throw new RangeError("aeChooser.item(): index out of range");
    }

    rv = inputElts[aIndex];

    return rv;
  }


  //
  // Event handler
  //

  set onClick(aFnClick)
  {
    this._fnClick = aFnClick;
  }


  //
  // Private helper method
  //

  _updateDlgFirstTabStop(aFirstElt)
  {
    // Update first keyboard-focusable element in aeDialog.
    if (this._hostDlg._firstTabStop instanceof HTMLInputElement
        && this._hostDlg._firstTabStop.type == "radio"
        && this._hostDlg._firstTabStop.dataset.chooserId == this._chooserElt.id) {
      this._hostDlg._firstTabStop = aFirstElt;
    }
  }
}
