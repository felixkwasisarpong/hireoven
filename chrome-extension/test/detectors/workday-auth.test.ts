/**
 * Workday forces sign-in / account creation before the application form on most
 * tenants. The agent must recognise those pages and pause (waiting_login) rather
 * than treat the auth fields as the application — otherwise it "fills" the login
 * form and the run dies. isWorkdayAuthPage() is that guard.
 *
 * The inverse matters just as much: the real My Information step also has a text
 * email field, so it must NOT be flagged as an auth page (that would pause the
 * run forever on a form it should be filling).
 */

import { beforeEach, describe, expect, it } from "vitest"
import { isWorkdayAuthPage } from "../../src/detectors/ats"

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("isWorkdayAuthPage", () => {
  it("detects the Workday create-account step (verifyPassword)", () => {
    document.body.innerHTML = `
      <div data-automation-id="createAccountPage">
        <input data-automation-id="email" type="text" />
        <input data-automation-id="password" type="password" />
        <input data-automation-id="verifyPassword" type="password" />
      </div>`
    expect(isWorkdayAuthPage(document)).toBe(true)
  })

  it("detects the Workday sign-in panel", () => {
    document.body.innerHTML = `
      <div data-automation-id="signInContent">
        <input data-automation-id="email" type="text" />
        <input data-automation-id="password" type="password" />
      </div>`
    expect(isWorkdayAuthPage(document)).toBe(true)
  })

  it("does NOT flag the My Information application step", () => {
    // Real Workday form step: has an email field but no auth containers.
    document.body.innerHTML = `
      <div data-automation-id="applyFlowPage">
        <input data-automation-id="email" type="text" value="jane@example.com" />
        <input data-automation-id="legalNameSection_firstName" type="text" />
      </div>`
    expect(isWorkdayAuthPage(document)).toBe(false)
  })
})
