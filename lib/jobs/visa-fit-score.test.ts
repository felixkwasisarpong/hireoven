import test from "node:test"
import assert from "node:assert/strict"
import { calculateVisaFitScore } from "@/lib/jobs/visa-fit-score"

test("calculateVisaFitScore blocks jobs with sponsorship blockers", () => {
  const result = calculateVisaFitScore({
    jobTitle: "Software Engineer",
    companyName: "Acme",
    sponsorsH1b: true,
    recentLcaCount: 50,
    sponsorshipBlocker: {
      detected: true,
      kind: "no_sponsorship_statement",
      severity: "high",
      evidence: ["We are unable to sponsor visas for this role."],
      source: "job_description",
      confidence: "high",
    },
  })

  assert.equal(result.label, "Blocked")
  assert.equal(result.confidence, "high")
  assert.ok(result.score < 25)
  assert.ok(result.warnings.some((warning) => /Blocker evidence/i.test(warning)))
})

test("calculateVisaFitScore rewards strong recent sponsor history", () => {
  const result = calculateVisaFitScore({
    jobTitle: "Senior Software Engineer",
    jobDescription: "Build distributed TypeScript and data platform systems.",
    companyName: "Globex",
    sponsorsH1b: true,
    sponsorshipScore: 86,
    priorLcaCount: 240,
    recentLcaCount: 45,
    roleFamilyLcaCount: 22,
    locationLcaCount: 18,
    wageLevelSignal: "strong",
    dataRecencyDays: 120,
    eVerify: true,
    capExempt: false,
  })

  assert.equal(result.label, "Very Strong")
  assert.equal(result.confidence, "high")
  assert.ok(result.score >= 82)
  assert.ok(result.reasons.some((reason) => /recent LCA/i.test(reason)))
  assert.equal(result.stemOptReadiness.eVerifyLikely, true)
})

test("calculateVisaFitScore warns when sponsor has no role-family match", () => {
  const result = calculateVisaFitScore({
    jobTitle: "Product Designer",
    jobDescription: "Design enterprise workflows.",
    companyName: "SponsorCo",
    sponsorsH1b: true,
    sponsorshipScore: 72,
    priorLcaCount: 90,
    recentLcaCount: 12,
    roleFamilyLcaCount: 0,
    locationLcaCount: 6,
    wageLevelSignal: "acceptable",
    dataRecencyDays: 220,
  })

  assert.ok(result.score >= 60)
  assert.ok(result.score < 82)
  assert.ok(result.warnings.some((warning) => /not for this role family/i.test(warning)))
})

test("calculateVisaFitScore keeps unknown company neutral but low confidence", () => {
  const result = calculateVisaFitScore({
    jobTitle: "Backend Engineer",
    jobDescription: "Build APIs and services.",
    companyName: "Unknown Startup",
  })

  assert.equal(result.label, "Medium")
  assert.equal(result.confidence, "low")
  assert.ok(result.dataGaps.length >= 5)
  assert.ok(result.score >= 45)
  assert.ok(result.score < 65)
})

test("calculateVisaFitScore marks cap-exempt separately from H1B score", () => {
  const result = calculateVisaFitScore({
    jobTitle: "Research Software Engineer",
    jobDescription: "Build scientific computing platforms for a university research lab.",
    companyName: "Example University",
    sponsorsH1b: null,
    priorLcaCount: null,
    recentLcaCount: null,
    roleFamilyLcaCount: null,
    locationLcaCount: null,
    capExempt: {
      isLikelyCapExempt: true,
      category: "higher_education",
      confidence: "high",
      evidence: ["University employer"],
      summary: "Likely higher education employer.",
    },
  })

  assert.equal(result.capExempt?.isLikelyCapExempt, true)
  assert.equal(result.capExempt?.category, "higher_education")
  assert.ok(result.reasons.some((reason) => /cap-exempt/i.test(reason)))
  assert.ok(result.warnings.some((warning) => /not be blended blindly/i.test(warning)))
  assert.ok(result.score < 70)
})

