import { describe, it, expect } from "vitest"
import { estimateWorkdayAutofillFields } from "../../src/autofill/workday-autofill"
import type { SafeProfile } from "../../src/api-types"

// estimateWorkdayAutofillFields is pure (no DOM) — it drives the apex-bar preview
// ("≈N fields across 4 sections"). These lock its deterministic math so the
// preview can't silently drift.
describe("estimateWorkdayAutofillFields", () => {
  const base: SafeProfile = {
    first_name: "FELIX",
    last_name: "SARPONG",
    email: "felix@example.com",
    phone: "555-123-4567",
    city: "Austin",
    state: "TX",
    country: "United States",
    authorized_to_work: true,
    requires_sponsorship: false,
  }

  it("estimates a full profile (6yrs, a degree, linkedin + portfolio)", () => {
    const profile = {
      ...base,
      years_of_experience: 6, // -> round(6/3)=2 jobs -> experience 20
      highest_degree: "BSc", // -> education 6
      resume_linkedin_url: "https://linkedin.com/in/felix", // +2
      resume_portfolio_url: "https://felix.dev", // +2
    } as SafeProfile
    const e = estimateWorkdayAutofillFields(profile)
    expect(e.myInformation).toBe(12)
    expect(e.experience).toBe(20)
    expect(e.education).toBe(6)
    expect(e.skills).toBe(12)
    expect(e.websites).toBe(4)
    expect(e.questions).toBe(8)
    expect(e.total).toBe(62)
  })

  it("estimates a minimal profile (no experience/degree/urls) with a floor of 1 job", () => {
    const e = estimateWorkdayAutofillFields(base)
    expect(e.experience).toBe(10) // floor of 1 job * 10
    expect(e.education).toBe(0)
    expect(e.websites).toBe(0)
    expect(e.total).toBe(42) // 12 + 10 + 0 + 12 + 0 + 8
  })

  it("caps experience at 4 jobs for very senior profiles", () => {
    const profile = { ...base, years_of_experience: 30 } as SafeProfile
    expect(estimateWorkdayAutofillFields(profile).experience).toBe(40) // min(4, 10) * 10
  })
})
