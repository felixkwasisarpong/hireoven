/**
 * Regression test for "Snap Resume couldn't snap in" on Ashby-style forms.
 *
 * These forms render a convenience "Autofill from resume" parser upload ABOVE
 * the real required "Resume *" field. Both accept .pdf/.docx, so the old
 * first-match picker dropped the résumé into the parser (which shows no file
 * chip) instead of the submission field. The scored picker must choose the
 * real Resume field.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { pickResumeFileInput, scoreResumeFileInput } from "../../src/autofill/resume-target"

const ASHBY_HTML = `
  <main>
    <div class="autofill-banner">
      <p>Autofill from resume</p>
      <p>Upload your resume here to autofill key application fields.</p>
      <input id="parser-upload" type="file" accept=".pdf,.doc,.docx" />
    </div>
    <form class="_ashby-application-form">
      <div class="_fieldEntry_x">
        <label>First Name</label>
        <input type="text" />
      </div>
      <div class="_fieldEntry_x">
        <label>Resume <span aria-hidden="true">*</span></label>
        <input id="resume-field" type="file" accept=".pdf,.doc,.docx" required />
      </div>
    </form>
  </main>`

describe("pickResumeFileInput", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("targets the real Resume field, not the 'Autofill from resume' parser banner", () => {
    document.body.innerHTML = ASHBY_HTML
    const picked = pickResumeFileInput(document)
    expect(picked?.id).toBe("resume-field")
    // The parser banner must score lower than the submission field.
    const parser = document.getElementById("parser-upload") as HTMLInputElement
    const field = document.getElementById("resume-field") as HTMLInputElement
    expect(scoreResumeFileInput(field, document)).toBeGreaterThan(
      scoreResumeFileInput(parser, document),
    )
  })

  it("never picks an image/avatar-only upload", () => {
    document.body.innerHTML = `
      <form>
        <input id="avatar" type="file" accept="image/png,image/jpeg" />
        <div><label>Resume</label><input id="resume-field" type="file" accept=".pdf,.docx" required /></div>
      </form>`
    expect(pickResumeFileInput(document)?.id).toBe("resume-field")
    const avatar = document.getElementById("avatar") as HTMLInputElement
    expect(scoreResumeFileInput(avatar, document)).toBeLessThanOrEqual(-50)
  })

  it("prefers the résumé slot over a cover-letter slot", () => {
    document.body.innerHTML = `
      <form>
        <div><label>Cover Letter</label><input id="cl" type="file" accept=".pdf,.docx" /></div>
        <div><label>Resume</label><input id="resume-field" type="file" accept=".pdf,.docx" required /></div>
      </form>`
    expect(pickResumeFileInput(document)?.id).toBe("resume-field")
  })

  it("falls back to the only file input when context is ambiguous", () => {
    document.body.innerHTML = `<form><input id="lonely" type="file" /></form>`
    expect(pickResumeFileInput(document)?.id).toBe("lonely")
  })

  it("returns null when there is no file input", () => {
    document.body.innerHTML = `<form><input type="text" /></form>`
    expect(pickResumeFileInput(document)).toBeNull()
  })
})
