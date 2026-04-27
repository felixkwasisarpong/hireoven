import test from "node:test"
import assert from "node:assert/strict"
import { buildJobCardFactList, buildJobEvidenceFacts, formatEmploymentTypeForCard, formatWorkModeForCard } from "@/lib/jobs/job-evidence-facts"
import type { Job } from "@/types"

function baseJob(over: Partial<Job> = {}): Job {
  return {
    id: "j1",
    company_id: "c1",
    title: "Software Engineer",
    department: null,
    location: null,
    is_remote: false,
    is_hybrid: false,
    employment_type: null,
    seniority_level: "mid",
    salary_min: null,
    salary_max: null,
    salary_currency: "USD",
    description: null,
    apply_url: "https://example.com",
    external_id: null,
    first_detected_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    is_active: true,
    sponsors_h1b: null,
    sponsorship_score: 0,
    visa_language_detected: null,
    requires_authorization: false,
    skills: null,
    normalized_title: null,
    raw_data: null,
    h1b_prediction: null,
    h1b_prediction_at: null,
    job_intelligence: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  }
}

test("remote parsed from description (bare remote keyword)", () => {
  const facts = buildJobEvidenceFacts(
    baseJob({
      description: "We are a fully remote team distributed across the US. No on-site requirement.",
    })
  )
  assert.equal(facts.workMode.value, "remote")
  assert.equal(formatWorkModeForCard(facts.workMode.value ?? "unknown"), "Remote")
})

test("hybrid parsed from description", () => {
  const facts = buildJobEvidenceFacts(
    baseJob({
      description: "This is a hybrid role with 2-3 days per week in our Seattle office. Remote work the rest of the week.",
    })
  )
  assert.equal(facts.workMode.value, "hybrid")
  assert.equal(formatWorkModeForCard(facts.workMode.value ?? "unknown"), "Hybrid")
})

test("no salary returns not_found", () => {
  const facts = buildJobEvidenceFacts(
    baseJob({
      description: "Great benefits. Apply today. No comp listed.",
    })
  )
  assert.ok(facts.salary.value)
  assert.equal(facts.salary.value?.kind, "not_found")
  const list = buildJobCardFactList(facts, 4)
  assert.equal(list.find((i) => i.id === "salary"), undefined)
})

test("explicit annual salary range parses to posted (USD, year)", () => {
  const facts = buildJobEvidenceFacts(
    baseJob({
      description: "The compensation for this position is $120,000 - $160,000 per year, plus benefits.",
    })
  )
  assert.equal(facts.salary.value?.kind, "posted")
  assert.equal(facts.salary.value?.currency, "USD")
  const list = buildJobCardFactList(facts, 4)
  assert.ok(list.some((i) => i.id === "salary"))
  assert.match(list.find((i) => i.id === "salary")?.displayText ?? "", /\$120k–\$160k|\$120k-\$160k/)
})

test("estimated salary is labeled Estimated in the card list", () => {
  const facts = buildJobEvidenceFacts(
    baseJob({
      description: "No public compensation.",
      raw_data: {
        salary_kind: "estimated",
        estimated_salary_min: 95_000,
        estimated_salary_max: 120_000,
      },
    })
  )
  assert.equal(facts.salary.value?.kind, "estimated")
  const d = buildJobCardFactList(facts, 4).find((i) => i.id === "salary")?.displayText
  assert.match(d ?? "", /^Estimated \$/)
})

test("company HQ is not used as high-confidence location when it is the only source", () => {
  const facts = buildJobEvidenceFacts(
    baseJob({
      location: null,
      description: "About the product…",
      raw_data: { headquarters: "Austin, TX" },
    })
  )
  assert.equal(facts.location.confidence, "low")
  assert.equal(facts.location.source, "derived")
  assert.equal(facts.location.value?.[0], "Austin, TX")
  assert.ok(facts.location.reason?.length)
})

test("structured full-time employment maps to title case", () => {
  const facts = buildJobEvidenceFacts(
    baseJob({
      employment_type: "fulltime",
    })
  )
  assert.equal(facts.employmentType.value, "full_time")
  assert.equal(facts.employmentType.confidence, "high")
  assert.equal(formatEmploymentTypeForCard("full_time"), "Full-time")
})

test("k-style salary range in description", () => {
  const facts = buildJobEvidenceFacts(
    baseJob({
      description: "Pay: $90k - $120k (USD) annual.",
    })
  )
  if (facts.salary.value?.kind === "posted") {
    assert.ok(facts.salary.value.min)
    assert.ok(facts.salary.value.max)
  } else {
    assert.fail("expected posted salary from k-range")
  }
})
