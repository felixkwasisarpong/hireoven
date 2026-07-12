import { describe, it, expect, beforeEach } from "vitest"
import { removeExistingResumeAttachment } from "../../src/autofill/resume-target"

beforeEach(() => { document.body.innerHTML = "" })

describe("removeExistingResumeAttachment", () => {
  it("removes an existing résumé attachment (returning-applicant / prefill)", () => {
    document.body.innerHTML = `
      <section class="resume-step">
        <h3>Resume</h3>
        <div class="file-attachment">
          <span class="filename">Jane_Doe_Resume.pdf</span>
          <button type="button" aria-label="Remove résumé" id="rm">Remove</button>
        </div>
        <input type="file" id="resume-input" />
      </section>`
    const btn = document.getElementById("rm")!
    btn.addEventListener("click", () => btn.closest(".file-attachment")?.remove())
    const removed = removeExistingResumeAttachment(document)
    expect(removed).toBe(true)
    expect(document.querySelector(".file-attachment")).toBeNull()
  })

  it("returns false when no résumé is attached (fresh form)", () => {
    document.body.innerHTML = `
      <section class="resume-step"><h3>Resume</h3><input type="file" /></section>`
    expect(removeExistingResumeAttachment(document)).toBe(false)
  })

  it("does NOT touch an unrelated remove control (e.g. a cover-letter attachment)", () => {
    document.body.innerHTML = `
      <div class="file-attachment">
        <span class="filename">Cover_Letter.pdf</span>
        <button aria-label="Remove cover letter">Remove</button>
      </div>`
    // No résumé/CV context anywhere → must not fire.
    expect(removeExistingResumeAttachment(document)).toBe(false)
  })

  it("handles an × icon remove control inside a résumé row", () => {
    document.body.innerHTML = `
      <li class="attachment"><span>resume: cv_final.docx</span><button aria-label="delete">×</button></li>`
    const btn = document.querySelector("button")!
    let clicked = false
    btn.addEventListener("click", () => { clicked = true })
    expect(removeExistingResumeAttachment(document)).toBe(true)
    expect(clicked).toBe(true)
  })
})
