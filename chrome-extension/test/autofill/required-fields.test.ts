/**
 * The apply agent must never click Submit while required fields are empty.
 * findUnfilledRequiredFields() is the guard — it returns the labels of the
 * required-but-empty fields (empty array ⇒ safe to submit).
 *
 * Markup mirrors the real Snowflake Ashby form: required text inputs, a hidden
 * required résumé file input, a required typeahead Location combobox, Yes/No
 * button groups, a required radio fieldset, and a required consent checkbox.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { findUnfilledRequiredFields } from "../../src/autofill/required-fields"

const EMPTY_FORM = `
  <div class="ashby-application-form-container">
    <div class="_fieldEntry ashby-application-form-field-entry">
      <label class="_label _required" for="name">Full Name<abbr>*</abbr></label>
      <input id="name" name="name" type="text" required value="" />
    </div>
    <div class="_fieldEntry ashby-application-form-field-entry">
      <label class="_label _required" for="phone">Phone Number<abbr>*</abbr></label>
      <input id="phone" name="phone" type="tel" required value="" />
    </div>
    <div class="_fieldEntry ashby-application-form-field-entry">
      <label class="_label _required" for="resume">Resume<abbr>*</abbr></label>
      <div role="presentation"><input id="resume" type="file" tabindex="-1" required /></div>
    </div>
    <div class="_fieldEntry ashby-application-form-field-entry">
      <label class="_label _required">Location<abbr>*</abbr></label>
      <input role="combobox" aria-expanded="false" value="" placeholder="Start typing..." />
    </div>
    <div class="_fieldEntry ashby-application-form-field-entry">
      <label class="_label _required">Will you require company sponsorship?<abbr>*</abbr></label>
      <div class="_yesno"><button>Yes</button><button>No</button>
        <input type="checkbox" tabindex="-1" /></div>
    </div>
    <fieldset class="_fieldEntry">
      <label class="_label _required">U.S. person status<abbr>*</abbr></label>
      <input type="radio" name="usp" id="usp0" /><label for="usp0">I am a U.S. person</label>
      <input type="radio" name="usp" id="usp1" /><label for="usp1">Other</label>
    </fieldset>
    <fieldset class="_fieldEntry">
      <label class="_label _required">Privacy Notice<abbr>*</abbr></label>
      <input type="checkbox" id="privacy" /><label for="privacy">I agree</label>
    </fieldset>
    <fieldset class="_fieldEntry">
      <label class="_label">Gender</label>
      <input type="radio" name="g" id="g0" /><label for="g0">Male</label>
    </fieldset>
  </div>`

describe("findUnfilledRequiredFields", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("flags every required-but-empty field on the empty Snowflake form", () => {
    document.body.innerHTML = EMPTY_FORM
    const missing = findUnfilledRequiredFields(document).map((l) => l.toLowerCase())
    expect(missing.some((l) => l.includes("full name"))).toBe(true)
    expect(missing.some((l) => l.includes("phone"))).toBe(true)
    expect(missing.some((l) => l.includes("resume"))).toBe(true)
    expect(missing.some((l) => l.includes("location"))).toBe(true)
    expect(missing.some((l) => l.includes("sponsorship"))).toBe(true)
    expect(missing.some((l) => l.includes("u.s. person"))).toBe(true)
    expect(missing.some((l) => l.includes("privacy"))).toBe(true)
  })

  it("does NOT flag the optional (non-required) EEO Gender field", () => {
    document.body.innerHTML = EMPTY_FORM
    const missing = findUnfilledRequiredFields(document).map((l) => l.toLowerCase())
    expect(missing.some((l) => l.includes("gender"))).toBe(false)
  })

  it("returns empty (safe to submit) once every required field is satisfied", () => {
    document.body.innerHTML = EMPTY_FORM
    ;(document.getElementById("name") as HTMLInputElement).value = "Felix Sarpong"
    ;(document.getElementById("phone") as HTMLInputElement).value = "555-1234"
    // résumé: simulate an attached file (jsdom has no DataTransfer)
    const resume = document.getElementById("resume") as HTMLInputElement
    Object.defineProperty(resume, "files", { value: { length: 1, 0: {} }, configurable: true })
    ;(document.querySelector('input[role="combobox"]') as HTMLInputElement).value = "Lubbock, TX"
    // sponsorship → mark a Yes/No button active
    document.querySelector(".\\_yesno button")?.classList.add("_active")
    ;(document.getElementById("usp0") as HTMLInputElement).checked = true
    ;(document.getElementById("privacy") as HTMLInputElement).checked = true

    expect(findUnfilledRequiredFields(document)).toEqual([])
  })
})
