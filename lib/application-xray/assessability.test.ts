import assert from "node:assert/strict"
import test from "node:test"
import { assessPosting, IMPLAUSIBLE_POSTING_AGE_DAYS } from "./assessability"
import { scoreApplicationXRay } from "./scorer"
import { baseInputForTraceTests } from "./test-helpers"

const NOW = "2026-08-14T12:00:00.000Z"

function assess(overrides: Partial<Parameters<typeof assessPosting>[0]>) {
  return assessPosting({
    title: "Software Engineer",
    description: "Responsibilities: build services. Requirements: 5 years of experience with Java.",
    applyUrl: "https://jobs.example/1",
    externalId: "REQ-1",
    ageDays: 30,
    applyUrlStatus: "unknown",
    lastSeenAt: null,
    lastSeenAtTrustworthy: false,
    now: NOW,
    ...overrides,
  })
}

// ─── A. short and generic, no duties or requirements ────────────────────────

test("A: a generic 337-character description with no duties or requirements is not assessable", () => {
  const verdict = assess({
    title: "Software Engineer, Applied AI",
    description:
      "We are a fast-growing company building the future of work. Our team is distributed and " +
      "we value curiosity, ownership and a high bar. If this sounds like you, we would love to " +
      "hear from you. We offer competitive compensation and a collaborative culture where great " +
      "people do their best work every single day.",
  })
  assert.equal(verdict.state, "INSUFFICIENT_JOB_CONTENT")
  assert.equal(verdict.blocksDecision, true)
})

test("A: it reaches INSUFFICIENT_DATA rather than APPLY_NOW through the engine", () => {
  const input = baseInputForTraceTests()
  input.jobRecords[0]!.descriptionText =
    "We are a fast-growing company building the future of work. Our team is distributed and we " +
    "value curiosity, ownership and a high bar. We offer competitive compensation."
  const xray = scoreApplicationXRay(input)
  assert.equal(xray.finalAction, "INSUFFICIENT_DATA")
  assert.equal(xray.decisionTrace.selectedRuleId, "RD0")
  assert.notEqual(xray.finalAction, "APPLY_NOW")
})

// ─── B. equally short, but structured ───────────────────────────────────────

test("B: a short but structured posting continues through the decision table", () => {
  const verdict = assess({
    title: "Backend Engineer",
    description:
      "You will design payment APIs and maintain our billing services. " +
      "Requirements: 4 years of experience with Java, proficiency with PostgreSQL.",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
  })
  assert.notEqual(verdict.state, "INSUFFICIENT_JOB_CONTENT")
  assert.equal(verdict.blocksDecision, false, "length alone must never block")
})

test("B: brevity alone does not block", () => {
  const short = assess({
    title: "Data Engineer",
    description: "You will build pipelines and own data quality. Requirements: 3 years experience with Python, familiar with Airflow.",
  })
  assert.equal(short.blocksDecision, false)
  assert.ok(short.inputs.descriptionLength as number < 200, "fixture should be genuinely short")
})

// ─── C. department / navigation page captured as a job ──────────────────────

test("C: 'engineering and product' with no requisition is not a job posting", () => {
  const verdict = assess({
    title: "engineering and product",
    description: "Explore our teams. Engineering. Product. Design. See all open roles across the company.",
    externalId: null,
    applyUrl: "https://example.com/careers",
  })
  assert.equal(verdict.state, "NOT_A_JOB_POSTING")
  assert.equal(verdict.blocksDecision, true)
})

test("C: it never reaches a capability judgment", () => {
  const input = baseInputForTraceTests()
  input.jobRecords[0]!.title = "engineering and product"
  input.jobRecords[0]!.descriptionText = "Explore our teams. Engineering. Product. Design."
  input.jobRecords[0]!.externalId = null
  const xray = scoreApplicationXRay(input)
  assert.equal(xray.finalAction, "INSUFFICIENT_DATA")
  assert.equal(xray.decisionTrace.selectedRuleId, "RD0")
})

// ─── D. corrupt age, but independently confirmed live ───────────────────────

test("D: an implausible age is ignored when a URL probe confirms the posting is live", () => {
  const verdict = assess({
    ageDays: 6095,
    applyUrlStatus: "ok",
  })
  assert.notEqual(verdict.state, "CORRUPT_TIMING_DATA")
  assert.notEqual(verdict.state, "NOT_A_JOB_POSTING")
  assert.equal(verdict.blocksDecision, false)
  assert.equal(verdict.inputs.ageImplausible, true, "the corrupt age is still recorded")
  assert.equal(verdict.inputs.recentlyConfirmedLive, true)
})

test("D: a recent trustworthy lastSeenAt also rescues a corrupt age", () => {
  const verdict = assess({
    ageDays: 6095,
    applyUrlStatus: "unknown",
    lastSeenAt: "2026-08-10T00:00:00.000Z",
    lastSeenAtTrustworthy: true,
  })
  assert.equal(verdict.blocksDecision, false)
  assert.equal(verdict.inputs.recentlyConfirmedLive, true)
})

// ─── E. corrupt age with no trustworthy liveness ────────────────────────────

test("E: an implausible age with no liveness evidence is CORRUPT_TIMING_DATA, not CLOSED", () => {
  const verdict = assess({
    ageDays: 6095,
    applyUrlStatus: "unknown",
    lastSeenAt: null,
    lastSeenAtTrustworthy: false,
  })
  assert.equal(verdict.state, "CORRUPT_TIMING_DATA")
  assert.equal(verdict.blocksDecision, true)
  assert.match(verdict.explanation, /not plausible/i)
  assert.match(verdict.explanation, /not evidence the role is closed/i)
})

test("E: it yields INSUFFICIENT_DATA with verify_posting, never APPLY_NOW or CLOSED", () => {
  const input = baseInputForTraceTests()
  input.jobRecords[0]!.availability.ageDays = 6095
  input.jobRecords[0]!.availability.applyUrlStatus = "unknown"
  input.jobRecords[0]!.availability.lastSeenAt = null
  input.jobRecords[0]!.availability.lastSeenAtTrustworthy = false
  const xray = scoreApplicationXRay(input)
  assert.equal(xray.finalAction, "INSUFFICIENT_DATA")
  assert.equal(xray.decisionTrace.selectedRuleId, "RD0")
  assert.notEqual(xray.summary.bands.hiringReality, "CLOSED")
  assert.ok(
    xray.actions.some((action) => action.kind === "verify_posting"),
    `expected verify_posting, got ${xray.actions.map((a) => a.kind).join(",")}`,
  )
})

// ─── trace completeness ─────────────────────────────────────────────────────

test("the assessability verdict records every input it used", () => {
  const verdict = assess({})
  for (const key of [
    "hasTitle", "titleIsNavigation", "titleHasRoleNoun", "dutyCount", "requirementCount",
    "hasApplyRoute", "hasRequisition", "descriptionLength", "ageDays", "ageImplausible",
    "applyUrlStatus", "lastSeenDays", "lastSeenAtTrustworthy", "recentlyConfirmedLive",
  ]) {
    assert.ok(key in verdict.inputs, `missing assessability input: ${key}`)
  }
})

test("RD0 puts the assessability inputs into the decision trace", () => {
  const input = baseInputForTraceTests()
  input.jobRecords[0]!.descriptionText = "We value curiosity and ownership."
  const xray = scoreApplicationXRay(input)
  const row = xray.decisionTrace.evaluated.find((e) => e.outcome === "selected_action")
  assert.equal(row?.firedRuleId, "RD0")
  assert.ok("assessability" in (row?.inputs ?? {}))
  assert.ok("dutyCount" in (row?.inputs ?? {}))
  assert.ok("requirementCount" in (row?.inputs ?? {}))
})

test("the implausible-age threshold is a named constant", () => {
  assert.equal(IMPLAUSIBLE_POSTING_AGE_DAYS, 5_000)
})
