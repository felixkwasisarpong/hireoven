/**
 * Regression test for the new React/Remix Greenhouse job-boards form
 * (job-boards.greenhouse.io). It reproduces the two bugs that made autofill
 * appear to "try but fill nothing":
 *
 *  1. react-select widgets render a hidden plumbing <input aria-hidden tabindex=-1>
 *     with no id, so buildSelector returned the bare tag `input` which resolved
 *     to the FIRST input on the page — clobbering #first_name.
 *  2. react-select comboboxes were treated as fillable text and silently failed.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { buildAutofillPreview, applySafeFills } from "../../src/autofill/safe-fields"

// Mirrors the real SpaceX markup: plain text inputs + a react-select combobox
// (#country) whose container also holds an aria-hidden requiredInput plumbing
// element, plus a "Location (City)" combobox.
const FORM_HTML = `
  <form id="application-form" class="application--form">
    <input id="first_name" aria-label="First Name" type="text" autocomplete="given-name" value="" />
    <input id="last_name" aria-label="Last Name" type="text" autocomplete="family-name" value="" />
    <input id="email" aria-label="Email" type="text" autocomplete="email" value="" />
    <input id="phone" aria-label="Phone" type="tel" value="" />
    <div class="select__control">
      <input class="select__input" id="country" role="combobox" aria-autocomplete="list"
             aria-haspopup="true" aria-labelledby="country-label" type="text" value="" />
      <input required tabindex="-1" aria-hidden="true" class="remix-requiredInput" value="" />
    </div>
    <div class="select__control">
      <input class="select__input" id="candidate-location" role="combobox" aria-autocomplete="list"
             aria-labelledby="candidate-location-label" type="text" value="" />
      <input required tabindex="-1" aria-hidden="true" class="remix-requiredInput" value="" />
    </div>
    <input id="resume" type="file" accept=".pdf,.doc,.docx" />
  </form>`

const profile = {
  first_name: "Felix",
  last_name: "Sarpong",
  full_name: "Felix Sarpong",
  email: "felix@example.com",
  phone: "555-123-4567",
  city: "Accra",
  location: "Accra, Ghana",
} as Parameters<typeof buildAutofillPreview>[1]

describe("Greenhouse React/Remix autofill", () => {
  beforeEach(() => {
    document.body.innerHTML = FORM_HTML
  })

  it("does not emit phantom rows with a bare `input` selector", () => {
    const rows = buildAutofillPreview("greenhouse", profile, document)
    const bareInputSelectors = rows.filter((r) => r.selector === "input")
    expect(bareInputSelectors).toHaveLength(0)
  })

  it("fills the plain text fields and never clobbers #first_name", async () => {
    await applySafeFills("greenhouse", profile, null, document)
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value
    expect(get("first_name")).toBe("Felix")
    expect(get("last_name")).toBe("Sarpong")
    expect(get("email")).toBe("felix@example.com")
    expect(get("phone")).toBe("555-123-4567")
  })

  it("skips react-select comboboxes instead of silently failing on them", () => {
    const rows = buildAutofillPreview("greenhouse", profile, document)
    const country = rows.find((r) => r.selector === "#country")
    const location = rows.find((r) => r.selector === "#candidate-location")
    // Present in the read-out, but not counted as a successfully-fillable text field.
    expect(country?.source).toBe("manual_required")
    expect(location?.source).toBe("manual_required")
  })

  it("reports a healthy fillable/filled ratio (no 'fillable>0 filled=0' dead end)", async () => {
    const results = await applySafeFills("greenhouse", profile, null, document)
    const fillable = results.filter(
      (r) => !r.skippedReason && r.source !== "manual_required" && r.source !== "cover_letter",
    )
    const filled = results.filter((r) => r.filled)
    expect(fillable.length).toBeGreaterThan(0)
    expect(filled.length).toBe(fillable.length)
  })
})
