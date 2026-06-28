/**
 * The autonomous run advances to the next job only when it recognises the
 * current page as a confirmation ("application submitted"). If detection misses
 * a Workday confirmation, the run stalls — the agent submitted but never moves
 * on. These tests pin the Workday-specific signals: the stable automation-id
 * containers and the "You've submitted your application" success copy.
 *
 * They also guard the inverse: a mid-application Workday review page must NOT be
 * mistaken for a confirmation (which would mark the job done before it is in).
 */

import { beforeEach, describe, expect, it } from "vitest"
import { detectConfirmation } from "../../src/detectors/confirmation"

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("detectConfirmation — Workday", () => {
  it("treats a Workday confirmation automation-id as high-confidence", () => {
    document.body.innerHTML = `
      <div data-automation-id="confirmationPage">
        <h1>Thank you</h1>
      </div>`
    const result = detectConfirmation(document)
    expect(result.isConfirmation).toBe(true)
    expect(result.confidence).toBe("high")
    expect(result.signals.some((s) => s.startsWith("ats-dom:"))).toBe(true)
  })

  it("detects Workday success copy ('You've submitted your application')", () => {
    document.body.innerHTML = `
      <main>
        <h2>You've submitted your application</h2>
        <p>We will be in touch if your qualifications match an open role.</p>
      </main>`
    const result = detectConfirmation(document)
    expect(result.isConfirmation).toBe(true)
    // text-only ⇒ at least medium so the run advances.
    expect(["high", "medium"]).toContain(result.confidence)
    expect(result.signals).toContain("visible-text")
  })

  it("does NOT flag a mid-application Workday review page as confirmation", () => {
    // The review step lists entered data and a Submit button, but carries no
    // success copy and no confirmation container.
    document.body.innerHTML = `
      <div data-automation-id="reviewStep">
        <h2>Review</h2>
        <section><label>Email</label><span>jane@example.com</span></section>
        <button data-automation-id="bottom-navigation-next-button">Submit</button>
      </div>`
    const result = detectConfirmation(document)
    expect(result.isConfirmation).toBe(false)
  })
})
