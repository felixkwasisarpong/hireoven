/**
 * Regression test for the Snowflake Ashby form (real markup).
 *
 * Two bugs this locks down:
 *  1. Scope selectors used `._ashby-application-form*` (with leading underscore)
 *     and required a <form>; the real DOM uses `ashby-application-form-container`
 *     on a <div>. So scoping missed and we fell back to the whole document —
 *     which made the résumé attach to the "Autofill from resume" PARSER pane
 *     instead of the required Resume field.
 *  2. The résumé must target `#_systemfield_resume` (the required field), never
 *     the parser-pane upload (which only triggers Ashby's prefill).
 *
 * EEO fields must remain skipped (sensitive).
 */

import { beforeEach, describe, expect, it } from "vitest"
import { buildAutofillPreview } from "../../src/autofill/safe-fields"

const HTML = `
  <div id="form" role="tabpanel">
    <div class="_autofillPane_x ashby-application-form-autofill-uploader _container_y">
      <input id="parser-upload" type="file" accept="application/pdf,.pdf,.docx" tabindex="-1" />
      <h3>Autofill from resume</h3>
      <p>Upload your resume here to autofill key application fields.</p>
    </div>
    <div class="_jobPostingForm_x ashby-application-form-container _container_y">
      <div class="_fieldEntry_x ashby-application-form-field-entry">
        <label for="_systemfield_name">Full Name</label>
        <div><input name="_systemfield_name" id="_systemfield_name" type="text" value="" /></div>
      </div>
      <div class="_fieldEntry_x ashby-application-form-field-entry">
        <label for="_systemfield_email">Email</label>
        <div><input name="_systemfield_email" id="_systemfield_email" type="email" value="" /></div>
      </div>
      <div class="_fieldEntry_x ashby-application-form-field-entry">
        <label for="_systemfield_resume">Resume</label>
        <div role="presentation" class="_container_resume">
          <input type="file" tabindex="-1" id="_systemfield_resume" required
                 accept="application/pdf,.pdf,.docx,image/*" />
          <div class="_instructions"><button>Upload File</button><p>or drag and drop here</p></div>
        </div>
      </div>
      <div class="_fieldEntry_x ashby-application-form-field-entry">
        <label for="b1890667">Additional Attachments</label>
        <div class="_description"><p>Cover Letter, Portfolio, Projects, etc</p></div>
        <div role="presentation" class="_container_extra">
          <input type="file" tabindex="-1" id="b1890667" accept=".pdf,.docx,image/*" />
        </div>
      </div>
      <div class="ashby-survey-form-container">
        <div class="_jobPostingForm_x ashby-application-form-container">
          <fieldset class="_fieldEntry_x">
            <label for="_systemfield_eeoc_gender">Gender</label>
            <input type="radio" id="g0" name="_systemfield_eeoc_gender" /><label for="g0">Male</label>
            <input type="radio" id="g1" name="_systemfield_eeoc_gender" /><label for="g1">Female</label>
          </fieldset>
        </div>
      </div>
    </div>
  </div>`

const profile = {
  first_name: "Felix",
  last_name: "Sarpong",
  full_name: "Felix Sarpong",
  email: "felix@example.com",
} as Parameters<typeof buildAutofillPreview>[1]

describe("Ashby Snowflake scope + résumé targeting", () => {
  beforeEach(() => {
    document.body.innerHTML = HTML
  })

  it("targets the required Resume field (#_systemfield_resume), not the parser pane", () => {
    const rows = buildAutofillPreview("ashby", profile, document)
    const resumeRows = rows.filter((r) => r.source === "resume")
    expect(resumeRows.map((r) => r.selector)).toContain("#_systemfield_resume")
    // The "Autofill from resume" parser-pane input must NOT be a résumé target.
    expect(resumeRows.some((r) => r.selector === "#parser-upload")).toBe(false)
    expect(rows.some((r) => r.selector === "#parser-upload")).toBe(false)
  })

  it("does not treat the cover-letter/Additional Attachments slot as the résumé", () => {
    const rows = buildAutofillPreview("ashby", profile, document)
    const resumeRows = rows.filter((r) => r.source === "resume")
    expect(resumeRows.some((r) => r.selector === "#b1890667")).toBe(false)
  })

  it("still resolves the scoped name/email fields", () => {
    const rows = buildAutofillPreview("ashby", profile, document)
    expect(rows.some((r) => r.selector === "#_systemfield_name")).toBe(true)
    expect(rows.some((r) => r.selector === "#_systemfield_email")).toBe(true)
  })

  it("skips EEO gender as sensitive", () => {
    const rows = buildAutofillPreview("ashby", profile, document)
    const gender = rows.find((r) => /gender/i.test(r.label))
    // Either skipped as sensitive/manual, or not surfaced as a fillable value.
    if (gender) {
      expect(gender.source).toBe("manual_required")
      expect(gender.filled).toBe(false)
    }
  })
})
