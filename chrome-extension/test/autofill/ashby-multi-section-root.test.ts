// @vitest-environment jsdom
/**
 * Regression: Baseten's Ashby form splits ONE application form into two disjoint
 * sibling `.ashby-application-form-container`s — the main fields (Name/Email/…)
 * and a separate EEO block. findApplicationFormRoot scored by control count and
 * picked the LARGER (EEO, ~14 radios) container, dropping every main field →
 * "0 ready to fill · 14 need review" with only sensitive EEO rows. The fix climbs
 * to the common ancestor of same-selector siblings, and excludes the résumé
 * PARSER pane that then comes into scope.
 */
import { describe, expect, it } from "vitest"
import { buildAutofillPreview } from "../../src/autofill/safe-fields"
import type { SafeProfile } from "../../src/autofill/safe-fields"

describe("Ashby multi-section form root", () => {
  it("merges sibling form containers so main fields aren't dropped, and skips the parser pane", () => {
    document.body.innerHTML = `
      <div id="wrapper">
        <div class="ashby-application-form-autofill-uploader">
          <input type="file" aria-label="Autofill from resume" accept=".pdf,.doc" />
        </div>
        <div class="ashby-application-form-container">
          <div class="ashby-application-form-field-entry">
            <label for="name">Name</label><input id="name" type="text" />
          </div>
          <div class="ashby-application-form-field-entry">
            <label for="email">Email</label><input id="email" type="email" />
          </div>
          <div class="ashby-application-form-field-entry">
            <label for="linkedin">LinkedIn Profile</label><input id="linkedin" type="text" />
          </div>
        </div>
        <div class="ashby-application-form-container">
          ${["Male", "Female", "Decline to self-identify"]
            .map((g, i) => `<label><input type="radio" name="gender" id="g${i}" /> ${g}</label>`)
            .join("")}
          ${["A", "B", "C", "D", "E", "F", "G"]
            .map((r, i) => `<label><input type="radio" name="race" id="r${i}" /> ${r}</label>`)
            .join("")}
        </div>
      </div>`
    const profile: SafeProfile = {
      first_name: "Felix",
      last_name: "Sarpong",
      email: "f@x.com",
      linkedin_url: "https://linkedin.com/in/felix",
    }
    const preview = buildAutofillPreview("ashby", profile, document)
    const labels = preview.map((r) => r.label)

    // Main-section fields survive (previously dropped when only the EEO container won).
    expect(labels).toContain("Name")
    expect(labels).toContain("Email")
    expect(labels).toContain("LinkedIn Profile")

    // …and they resolve to a value → "ready to fill", not "needs review".
    const ready = preview.filter((r) => r.valuePreview && !r.skippedReason)
    expect(ready.map((r) => r.label)).toEqual(expect.arrayContaining(["Name", "Email", "LinkedIn Profile"]))

    // The résumé-parser dropzone must never be surfaced as the resume field.
    expect(preview.some((r) => r.source === "resume")).toBe(false)
  })
})
