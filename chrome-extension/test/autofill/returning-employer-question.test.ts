import { describe, it, expect } from "vitest"
import { isReturningEmployerQuestion } from "../../src/autofill/workday-autofill"

describe("isReturningEmployerQuestion", () => {
  it("matches the exact Workday screenshot phrasing → No", () => {
    expect(
      isReturningEmployerQuestion(
        "Have you been previously employed by Commerce or it's sub-brands - BigCommerce, Feedonomics or Makeswift?"
      )
    ).toBe(true)
  })

  it("matches common returning-employee variants", () => {
    for (const q of [
      "Are you a previous employee?",
      "Have you ever been employed by our company?",
      "Are you a former employee of Acme?",
      "Have you ever worked for us?",
      "Have you previously worked for Caterpillar Inc., Solar or any subsidiaries as an employee or contingent worker?",
      "Are you currently or previously employed by the company?",
      "Have you worked here before?",
    ]) {
      expect(isReturningEmployerQuestion(q), q).toBe(true)
    }
  })

  it("does NOT match unrelated 'previous employer' / relative questions", () => {
    for (const q of [
      "Do you have any obligations to a previous employer (non-compete)?",
      "Do you have a relative employed by this company?",
      "Is any family member currently employed here?",
      "Are you legally authorized to work in the U.S.?",
    ]) {
      expect(isReturningEmployerQuestion(q), q).toBe(false)
    }
  })
})
