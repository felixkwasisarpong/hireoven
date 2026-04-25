import test from "node:test"
import assert from "node:assert/strict"
import { calculateGhostJobRisk } from "@/lib/jobs/ghost-job-risk"

const NOW = new Date("2026-04-25T12:00:00.000Z")

test("calculateGhostJobRisk returns low risk for fresh direct ATS jobs", () => {
  const result = calculateGhostJobRisk({
    postedAt: "2026-04-22T12:00:00.000Z",
    lastVerifiedAt: "2026-04-25T08:00:00.000Z",
    applyUrlStatus: "ok",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/123",
    atsType: "greenhouse",
    description: "Build production software systems with a strong team. This role includes clear responsibilities, requirements, and impact across the platform.",
    salaryMin: 120000,
    salaryMax: 170000,
    repostCount: 1,
    locationCount: 1,
    duplicateCount: 0,
    now: NOW,
  })

  assert.equal(result.label, "Low")
  assert.equal(result.riskLevel, "low")
  assert.ok((result.riskScore ?? 100) < 40)
  assert.ok(result.signals.some((signal) => /recently verified/i.test(signal.label)))
})

test("calculateGhostJobRisk flags very old unverified postings", () => {
  const result = calculateGhostJobRisk({
    postedAt: "2025-12-01T12:00:00.000Z",
    lastVerifiedAt: "2026-01-15T12:00:00.000Z",
    applyUrlStatus: "unknown",
    description: "Software engineer role with clear responsibilities and requirements for backend systems development.",
    salaryMin: 100000,
    duplicateCount: 0,
    now: NOW,
  })

  assert.equal(result.label, "High")
  assert.ok(result.reasons.some((reason) => /very old/i.test(reason)))
  assert.ok(result.recommendedAction.includes("Verify"))
})

test("calculateGhostJobRisk increases risk for dead apply URLs", () => {
  const result = calculateGhostJobRisk({
    postedAt: "2026-04-01T12:00:00.000Z",
    lastVerifiedAt: "2026-04-10T12:00:00.000Z",
    applyUrlStatus: "404",
    applyUrl: "https://example.com/jobs/closed",
    description: "A normal job description with enough detail to understand the role and responsibilities.",
    now: NOW,
  })

  assert.equal(result.label, "High")
  assert.ok(result.reasons.some((reason) => /closed|expired|unreachable/i.test(reason)))
})

test("calculateGhostJobRisk handles reposted duplicate jobs", () => {
  const result = calculateGhostJobRisk({
    postedAt: "2026-03-20T12:00:00.000Z",
    lastVerifiedAt: "2026-04-20T12:00:00.000Z",
    applyUrlStatus: "ok",
    repostCount: 6,
    duplicateCount: 7,
    description: "This is a detailed role description with team context, responsibilities, requirements, and interview-ready details.",
    now: NOW,
  })

  assert.equal(result.label, "Medium")
  assert.ok(result.reasons.some((reason) => /reposted 6 times|seen or reposted 6 times/i.test(reason)))
  assert.ok(result.reasons.some((reason) => /similar title/i.test(reason)))
})

test("calculateGhostJobRisk does not over-penalize remote jobs with many locations", () => {
  const remote = calculateGhostJobRisk({
    postedAt: "2026-04-10T12:00:00.000Z",
    lastVerifiedAt: "2026-04-24T12:00:00.000Z",
    applyUrlStatus: "ok",
    locationCount: 18,
    isRemote: true,
    description: "Detailed remote role description with responsibilities, requirements, collaboration style, and hiring process.",
    now: NOW,
  })

  const onsite = calculateGhostJobRisk({
    postedAt: "2026-04-10T12:00:00.000Z",
    lastVerifiedAt: "2026-04-24T12:00:00.000Z",
    applyUrlStatus: "ok",
    locationCount: 18,
    isRemote: false,
    description: "Detailed onsite role description with responsibilities, requirements, collaboration style, and hiring process.",
    now: NOW,
  })

  assert.ok((remote.riskScore ?? 100) < (onsite.riskScore ?? 0))
  assert.ok(onsite.reasons.some((reason) => /18 locations/i.test(reason)))
})

test("calculateGhostJobRisk treats missing salary as weak signal only", () => {
  const withSalary = calculateGhostJobRisk({
    postedAt: "2026-04-20T12:00:00.000Z",
    lastVerifiedAt: "2026-04-24T12:00:00.000Z",
    applyUrlStatus: "ok",
    description: "Detailed role description with team context, responsibilities, requirements, and hiring process.",
    salaryMin: 120000,
    now: NOW,
  })

  const withoutSalary = calculateGhostJobRisk({
    postedAt: "2026-04-20T12:00:00.000Z",
    lastVerifiedAt: "2026-04-24T12:00:00.000Z",
    applyUrlStatus: "ok",
    description: "Detailed role description with team context, responsibilities, requirements, and hiring process.",
    now: NOW,
  })

  assert.equal(withoutSalary.label, "Low")
  assert.ok((withoutSalary.riskScore ?? 0) - (withSalary.riskScore ?? 0) <= 3)
  assert.ok(withoutSalary.reasons.some((reason) => /weak signal/i.test(reason)))
})

test("calculateGhostJobRisk returns unknown when source signals are absent", () => {
  const result = calculateGhostJobRisk({ now: NOW })

  assert.equal(result.label, "Unknown")
  assert.equal(result.riskScore, null)
  assert.ok(result.recommendedAction.includes("Not enough"))
})
