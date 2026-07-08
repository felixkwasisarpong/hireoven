/**
 * Regression test for separate City / State / Zip autofill on generic ATS forms.
 *
 * Before: safe-fields only had a combined `location` key that merged the
 * profile's city + state into "City, State". Forms with distinct City and
 * State inputs (very common on Greenhouse/Lever/generic forms) got either the
 * merged value dropped into City, or nothing at all in State.
 *
 * After: dedicated `city`/`state`/`zip_code` keys fill each input independently
 * while a single "Location" field still receives the combined value.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { buildAutofillPreview, applySafeFills } from "../../src/autofill/safe-fields"

const profile = {
  first_name: "Felix",
  last_name: "Sarpong",
  city: "San Francisco",
  state: "CA",
  zip_code: "94105",
} as Parameters<typeof buildAutofillPreview>[1]

describe("Separate City / State / Zip autofill", () => {
  it("fills distinct City, State and Zip inputs from the profile", async () => {
    document.body.innerHTML = `
      <form id="application-form" class="application--form">
        <input id="city" aria-label="City" type="text" autocomplete="address-level2" value="" />
        <input id="state" aria-label="State" type="text" autocomplete="address-level1" value="" />
        <input id="zip" aria-label="Zip Code" type="text" autocomplete="postal-code" value="" />
      </form>`

    await applySafeFills("greenhouse", profile, null, document)
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value
    expect(get("city")).toBe("San Francisco")
    expect(get("state")).toBe("CA")
    expect(get("zip")).toBe("94105")
  })

  it("still fills a single combined Location field", () => {
    document.body.innerHTML = `
      <form id="application-form" class="application--form">
        <input id="location" aria-label="Location" type="text" value="" />
      </form>`

    const rows = buildAutofillPreview("greenhouse", profile, document)
    const location = rows.find((r) => r.selector === "#location")
    expect(location?.fillValue).toBe("San Francisco, CA")
  })

  it("does not misclassify 'United States' / 'statement' labels as a state field", () => {
    document.body.innerHTML = `
      <form id="application-form" class="application--form">
        <textarea id="statement" aria-label="Personal statement"></textarea>
      </form>`

    const rows = buildAutofillPreview("greenhouse", profile, document)
    const statement = rows.find((r) => r.selector === "#statement")
    // \bstate\b must not fire inside "statement".
    expect(statement?.fillValue).toBeUndefined()
  })
})
