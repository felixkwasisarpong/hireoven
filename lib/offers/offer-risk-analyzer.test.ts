import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { calculateOfferRisk } from "@/lib/offers/offer-risk-analyzer"
import type { OfferRiskInput } from "@/types"

describe("calculateOfferRisk", () => {
  it("flags sponsorship conflicts as high risk for candidates who need support", () => {
    const result = calculateOfferRisk({
      company: "Acme Staffing",
      jobTitle: "Software Engineer",
      location: "Austin, TX",
      salary: 92_000,
      workAuthorizationStatus: "F1_STEM_OPT",
      needsOptStemSupport: true,
      needsFutureSponsorship: true,
      offerStartDate: "2026-02-15",
      workMode: "hybrid",
      sponsorshipStatement: "Candidates must be authorized to work without visa sponsorship now or in the future.",
      companySnapshot: {
        companyName: "Acme Staffing",
        sponsorsH1b: false,
        sponsorshipConfidence: 10,
        recentH1BCount: 0,
        totalLcaCount: 0,
        certificationRate: null,
        topJobTitles: [],
        topWorksiteStates: [],
        eVerifyLikely: null,
      },
      lcaRecords: [],
    })

    assert.equal(result.riskLabel, "High")
    assert.equal(result.sponsorshipConflictDetected, true)
    assert.ok(result.keyConcerns.some((item) => item.toLowerCase().includes("conflict")))
    assert.ok(result.questionsToAskRecruiter.some((item) => item.includes("clarify")))
  })

  it("recognizes positive sponsor, role, location, and salary signals", () => {
    const input: OfferRiskInput = {
      company: "Contoso",
      jobTitle: "Software Engineer",
      location: "Seattle, WA",
      salary: 145_000,
      workAuthorizationStatus: "F1_STEM_OPT",
      needsOptStemSupport: true,
      needsFutureSponsorship: true,
      offerStartDate: "2026-10-07",
      workMode: "hybrid",
      sponsorshipStatement: "Our immigration team can review work authorization needs after offer acceptance.",
      companySnapshot: {
        companyName: "Contoso",
        sponsorsH1b: true,
        sponsorshipConfidence: 86,
        recentH1BCount: 42,
        totalLcaCount: 320,
        certificationRate: 0.94,
        topJobTitles: ["Software Engineer", "Senior Software Engineer"],
        topWorksiteStates: ["WA", "CA"],
        eVerifyLikely: true,
      },
      lcaRecords: [
        {
          employerName: "Contoso",
          jobTitle: "Software Engineer",
          roleFamily: "Software Engineering",
          location: "Seattle, WA",
          worksiteState: "WA",
          wageRateFrom: 130_000,
          wageRateTo: 165_000,
          wageUnit: "Year",
          fiscalYear: 2025,
          wageLevel: "Level III",
        },
      ],
    }

    const result = calculateOfferRisk(input)

    assert.equal(result.riskLabel, "Low")
    assert.equal(result.salaryIntelligence.comparisonLabel, "Aligned")
    assert.ok(result.positiveSignals.length >= 3)
    assert.equal(result.h1bTimingRisk, "low")
    assert.equal(result.roleFamilyEvidence?.matchMethod, "title_family")
    assert.equal(result.locationEvidence?.matchLevel, "exact_city_state")
  })

  it("uses employer-wide-remote location evidence for remote offers", () => {
    const result = calculateOfferRisk({
      company: "Contoso",
      jobTitle: "Software Engineer",
      location: "Remote - US",
      salary: 120_000,
      workAuthorizationStatus: "H1B",
      workMode: "remote",
      lcaRecords: [
        { employerName: "Contoso", jobTitle: "Software Engineer", worksiteState: "CA", wageRateFrom: 120_000, wageUnit: "Year" },
      ],
    })

    assert.equal(result.locationEvidence?.matchLevel, "employer_wide_remote")
    assert.equal(result.locationEvidence?.confidence, "low")
  })

  it("returns unknown when core data is missing", () => {
    const result = calculateOfferRisk({
      company: "",
      jobTitle: "",
      workAuthorizationStatus: "unknown",
      workMode: "unknown",
    })

    assert.equal(result.riskLabel, "Unknown")
    assert.ok(result.missingData.includes("Company name is missing."))
    assert.ok(result.documentationChecklist.length > 0)
  })
})
