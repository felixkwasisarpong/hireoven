import { describe, it, expect } from "vitest"
import { isSensitiveWorkAuthQuestion } from "../../src/autofill/workday-autofill"

// These high-stakes work-authorization / immigration / conflict questions need
// special handling. Workday only auto-answers clear saved-profile work auth /
// sponsorship yes-no questions; citizenship/status/conflict remain manual.
describe("isSensitiveWorkAuthQuestion", () => {
  const sensitive = [
    // The exact CrowdStrike Workday questions from the live session.
    "Are you eligible to work in the country in which this position is located?",
    "Will you now or in the future require work authorization sponsorship?",
    "Please indicate the applicable Yes/No answer below ... whether a conflict of interest exists",
    // Common variants across tenants.
    "Are you legally authorized to work in the United States?",
    "Do you require visa sponsorship now or in the future?",
    "Will you require immigration sponsorship?",
    "Do you have the right to work in the UK?",
    "Are you a citizen of the United States?",
    "What is your current immigration status?",
    "Are you a permanent resident?",
  ]
  for (const q of sensitive) {
    it(`flags: "${q.slice(0, 48)}…"`, () => {
      expect(isSensitiveWorkAuthQuestion(q)).toBe(true)
    })
  }

  const nonSensitive = [
    "Why are you interested in working for CrowdStrike?",
    "How did you hear about us?",
    "Are you at least 18 years of age?",
    "Are you willing to undergo a background check?",
    "Have you previously worked for this company?",
    "What are your salary expectations?",
    "",
  ]
  for (const q of nonSensitive) {
    it(`does NOT flag: "${q.slice(0, 48)}"`, () => {
      expect(isSensitiveWorkAuthQuestion(q)).toBe(false)
    })
  }
})
