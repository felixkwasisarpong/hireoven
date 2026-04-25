import test from "node:test"
import assert from "node:assert/strict"
import { calculateApplicationVerdict } from "@/lib/jobs/application-verdict"

test("calculateApplicationVerdict returns Apply Today for strong non-international fit", () => {
  const result = calculateApplicationVerdict({
    resumeMatchScore: 88,
    visaRelevant: false,
    salaryAlignment: "Aligned",
    ghostJobRisk: { score: 12, riskLevel: "low", freshnessDays: 2, recommendedAction: "Apply normally." },
    companyHiringHealth: { status: "growing", activeJobCount: 24, recentJobCount: 8 },
  })

  assert.equal(result.verdict, "Apply Today")
  assert.equal(result.recommendation, "apply_now")
  assert.ok((result.priorityScore ?? 0) >= 78)
  assert.ok(result.reasons.some((reason) => /Strong resume match/i.test(reason)))
})

test("calculateApplicationVerdict skips international role with sponsorship blocker", () => {
  const result = calculateApplicationVerdict({
    resumeMatchScore: 82,
    visaFitScore: 72,
    userImmigrationProfile: { isInternational: true, needsSponsorship: true, status: "F1_OPT" },
    sponsorshipBlocker: true,
    ghostJobRisk: { score: 20, riskLevel: "low", freshnessDays: 4, recommendedAction: "Apply normally." },
  })

  assert.equal(result.verdict, "Skip")
  assert.equal(result.recommendation, "skip")
  assert.ok(result.warnings.some((warning) => /Sponsorship blocker/i.test(warning)))
})

test("calculateApplicationVerdict returns High Risk when blocker and ghost risk stack", () => {
  const result = calculateApplicationVerdict({
    resumeMatchScore: 68,
    visaFitScore: 30,
    userNeedsSponsorship: true,
    sponsorshipBlocker: true,
    ghostJobRisk: { score: 88, riskLevel: "high", freshnessDays: 120, recommendedAction: "Verify source." },
  })

  assert.equal(result.verdict, "High Risk")
  assert.equal(result.recommendation, "avoid")
  assert.ok((result.priorityScore ?? 100) <= 35)
})

test("calculateApplicationVerdict recommends customization for low match but strong opportunity", () => {
  const result = calculateApplicationVerdict({
    resumeMatchScore: 52,
    visaRelevant: false,
    salaryAlignment: "Above Market",
    ghostJobRisk: { score: 8, riskLevel: "low", freshnessDays: 1, recommendedAction: "Apply normally." },
    companyHiringHealth: { status: "growing", activeJobCount: 50, recentJobCount: 10 },
  })

  assert.equal(result.verdict, "Apply, But Customize Resume")
  assert.equal(result.recommendation, "apply_with_tweaks")
  assert.ok(result.warnings.some((warning) => /customize/i.test(warning)))
})

test("calculateApplicationVerdict returns Maybe for high ghost risk with otherwise decent signals", () => {
  const result = calculateApplicationVerdict({
    resumeMatchScore: 78,
    visaRelevant: false,
    salaryAlignment: "Aligned",
    ghostJobRisk: { score: 78, riskLevel: "high", freshnessDays: 95, recommendedAction: "Verify source." },
    companyHiringHealth: { status: "steady", activeJobCount: 6, recentJobCount: 1 },
  })

  assert.equal(result.verdict, "Maybe")
  assert.equal(result.recommendation, "watch")
  assert.ok(result.warnings.some((warning) => /Ghost-job risk/i.test(warning)))
})

test("calculateApplicationVerdict reduces confidence but does not fail on missing data", () => {
  const result = calculateApplicationVerdict({
    resumeMatchScore: null,
    visaRelevant: true,
    userNeedsSponsorship: true,
  })

  assert.notEqual(result.verdict, "Unknown")
  assert.equal(result.confidence, "low")
  assert.ok(result.warnings.some((warning) => /missing/i.test(warning)))
})

test("calculateApplicationVerdict handles international user with strong visa fit", () => {
  const result = calculateApplicationVerdict({
    resumeMatchScore: 84,
    visaFitScore: 78,
    userImmigrationProfile: { isInternational: true, needsSponsorship: true, status: "F1_STEM_OPT" },
    sponsorshipBlocker: false,
    salaryAlignment: "Aligned",
    ghostJobRisk: { score: 10, riskLevel: "low", freshnessDays: 3, recommendedAction: "Apply normally." },
  })

  assert.equal(result.verdict, "Apply Today")
  assert.equal(result.recommendation, "apply_now")
  assert.ok(result.reasons.some((reason) => /Visa fit/i.test(reason)))
})
