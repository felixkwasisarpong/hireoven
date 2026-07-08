import { describe, it, expect } from "vitest"
import { workAuthAnswer } from "../../src/autofill/work-auth"

// A US-authorized applicant who needs no sponsorship.
const authorized = { authorizedToWork: true, requiresSponsorship: false }
// An applicant who genuinely needs sponsorship.
const needsSponsor = { authorizedToWork: false, requiresSponsorship: true }

describe("workAuthAnswer — sponsorship phrasing (incl. BambooHR inverse)", () => {
  it('answers "Are you able to work in the US WITHOUT sponsorship?" = yes for an authorized applicant', () => {
    // Real BambooHR customQuestionAnswers.yes_no question (Highline careers/294).
    const q = "Are you able to work in the United States without sponsorship?"
    expect(workAuthAnswer(q, authorized)).toBe("yes")
  })

  it('answers the same WITHOUT-sponsorship question = no for someone who needs sponsorship', () => {
    const q = "Are you able to work in the United States without sponsorship?"
    expect(workAuthAnswer(q, needsSponsor)).toBe("no")
  })

  it('still answers "Do you require sponsorship?" = no for an authorized applicant (regression)', () => {
    expect(workAuthAnswer("Do you now or in the future require sponsorship?", authorized)).toBe("no")
  })

  it('still answers "Do you require sponsorship?" = yes for someone who needs it (regression)', () => {
    expect(workAuthAnswer("Will you require visa sponsorship?", needsSponsor)).toBe("yes")
  })

  it('answers "legally authorized to work?" = yes for an authorized applicant', () => {
    expect(workAuthAnswer("Are you legally authorized to work in the United States?", authorized)).toBe("yes")
  })

  it("returns null for a non-work-auth question", () => {
    expect(workAuthAnswer("What is your desired salary?", authorized)).toBeNull()
  })
})
