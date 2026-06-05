/**
 * Regression test for Ashby (jobs.ashbyhq.com) React SPA application forms.
 *
 * Ashby renders each field as a CSS-module row — `_fieldEntry_<hash>` — whose
 * <label> has NO `for` attribute, does not wrap the input, and carries no
 * aria-label/placeholder on the control. The old label resolver therefore fell
 * straight through to the input's opaque id (`_systemfield_name`), so the
 * autofill drawer showed a "long list of fields with no name" and could not
 * classify them → autofill only partially filled.
 *
 * The fix: a proximity climb that picks up the row's label-like element.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { buildAutofillPreview, applySafeFills } from "../../src/autofill/safe-fields"

// Mirrors real Ashby markup: label + control are siblings inside a hashed
// `_fieldEntry_` wrapper. No `for`, no aria, no placeholder. The asterisk in
// the required label must be stripped from the resolved name.
const FORM_HTML = `
  <form class="_ashby-application-form">
    <div class="_fieldEntry_hkyf8_29">
      <label class="_label_hkyf8_42">Name <span aria-hidden="true">*</span></label>
      <div class="_fieldEntryInner_hkyf8_50">
        <input id="_systemfield_name" class="_input_hkyf8_60" type="text" value="" />
      </div>
    </div>
    <div class="_fieldEntry_hkyf8_29">
      <label class="_label_hkyf8_42">Email <span aria-hidden="true">*</span></label>
      <div class="_fieldEntryInner_hkyf8_50">
        <input id="_systemfield_email" class="_input_hkyf8_60" type="email" value="" />
      </div>
    </div>
    <div class="_fieldEntry_hkyf8_29">
      <label class="_label_hkyf8_42">Phone</label>
      <div class="_fieldEntryInner_hkyf8_50">
        <input id="_systemfield_phone" class="_input_hkyf8_60" type="tel" value="" />
      </div>
    </div>
    <div class="_fieldEntry_hkyf8_29">
      <label class="_label_hkyf8_42">LinkedIn Profile</label>
      <div class="_fieldEntryInner_hkyf8_50">
        <input id="_customfield_abc123" class="_input_hkyf8_60" type="text" value="" />
      </div>
    </div>
    <div class="_fieldEntry_hkyf8_29">
      <label class="_label_hkyf8_42">Resume</label>
      <input type="file" accept=".pdf,.doc,.docx" />
    </div>
  </form>`

const profile = {
  first_name: "Felix",
  last_name: "Sarpong",
  full_name: "Felix Sarpong",
  email: "felix@example.com",
  phone: "555-123-4567",
  linkedin_url: "https://linkedin.com/in/felix",
} as Parameters<typeof buildAutofillPreview>[1]

describe("Ashby field-label resolution", () => {
  beforeEach(() => {
    document.body.innerHTML = FORM_HTML
  })

  it("resolves human labels from the `_fieldEntry_` row instead of falling back to the opaque id", () => {
    const rows = buildAutofillPreview("ashby", profile, document)
    const labels = rows.map((r) => r.label)
    expect(labels).toContain("Name")
    expect(labels).toContain("Email")
    expect(labels).toContain("Phone")
    expect(labels).toContain("LinkedIn Profile")
    // The previous failure mode: rows named after `_systemfield_…` ids.
    expect(labels.some((l) => l.startsWith("_systemfield"))).toBe(false)
    expect(labels).not.toContain("Unlabelled field")
  })

  it("strips the required-asterisk from resolved labels", () => {
    const rows = buildAutofillPreview("ashby", profile, document)
    expect(rows.map((r) => r.label)).not.toContain("Name *")
  })

  it("classifies and fills the now-labelled fields (no more partial autofill)", async () => {
    const results = await applySafeFills("ashby", profile, null, document)
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value
    expect(get("_systemfield_name")).toBe("Felix Sarpong")
    expect(get("_systemfield_email")).toBe("felix@example.com")
    expect(get("_systemfield_phone")).toBe("555-123-4567")
    expect(get("_customfield_abc123")).toBe("https://linkedin.com/in/felix")
  })
})
