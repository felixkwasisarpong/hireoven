import { describe, it, expect, afterEach } from "vitest"
import { isWorkdayApplicationPage } from "../../src/autofill/workday-autofill"

// isWorkdayApplicationPage() → WorkdayAutofillRunner.isWorkdayDetected().
// In jsdom the host is "localhost", so these exercise the DOM-signature path
// only — the fix that lets vanity / custom Workday domains (e.g. Synchrony,
// which don't serve from *.myworkdayjobs.com) be recognized so the bar engages
// instead of showing "Autofill not detected".
describe("Workday DOM detection (vanity domains)", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("is false on a plain page with no Workday markers", () => {
    document.body.innerHTML = `<div><h1>Some careers site</h1><button>Apply</button></div>`
    expect(isWorkdayApplicationPage()).toBe(false)
  })

  it("detects the apply-flow My-Info page wrapper", () => {
    document.body.innerHTML = `<div data-automation-id="applyFlowMyInfoPage"></div>`
    expect(isWorkdayApplicationPage()).toBe(true)
  })

  it("detects the pre-form 'Start Your Application' chooser via Apply Manually", () => {
    // The exact case the Synchrony screenshot hit: the chooser has no form
    // fields yet, only the three buttons — Apply Manually carries the id.
    document.body.innerHTML = `
      <div>
        <h2>Start Your Application</h2>
        <button data-automation-id="autofillWithResume">Autofill with Resume</button>
        <button data-automation-id="applyManually">Apply Manually</button>
        <button data-automation-id="useMyLastApplication">Use My Last Application</button>
      </div>`
    expect(isWorkdayApplicationPage()).toBe(true)
  })

  it("detects the classic application page marker", () => {
    document.body.innerHTML = `<div data-automation-id="applicationPage"></div>`
    expect(isWorkdayApplicationPage()).toBe(true)
  })

  it("detects the legal-name form field", () => {
    document.body.innerHTML = `<div data-automation-id="legalNameSection_firstName"></div>`
    expect(isWorkdayApplicationPage()).toBe(true)
  })
})
