import test from "node:test"
import assert from "node:assert/strict"
import {
  inferJobMetadata,
  inferSeniorityLevel,
} from "@/lib/jobs/metadata"

test("does not infer executive seniority from org-chart prose", () => {
  const description = `
You're joining a lean, high-impact engineering organization.
Our CTO sets the technical and AI vision. Our Director of Product owns the roadmap and the voice of the customer.
You will build AI features with Python, FastAPI, TypeScript, LLMs, RAG, and PostgreSQL.
`

  assert.equal(inferSeniorityLevel("AI Engineer", description), null)
  assert.equal(
    inferJobMetadata({
      title: "AI Engineer",
      description,
      location: "Davie, Florida",
    }).seniorityLevel,
    null
  )
})

test("trusts seniority terms in the title", () => {
  assert.equal(inferSeniorityLevel("Senior AI Engineer", "Our CTO sets the AI vision."), "senior")
  assert.equal(inferSeniorityLevel("Principal AI Engineer", "Our Director of Product owns the roadmap."), "principal")
})

test("uses explicit seniority labels from descriptions", () => {
  assert.equal(
    inferSeniorityLevel("AI Engineer", "Seniority: Senior. Build production AI systems."),
    "senior"
  )
  assert.equal(
    inferSeniorityLevel("AI Engineer", "This is a staff-level engineer role on the AI platform team."),
    "staff"
  )
})

// ── Entry-level titles ───────────────────────────────────────────────────────
// jobs.seniority_level is NULL on ~87% of rows, so the seniority gates can only
// fire on inference. "Graduate" carried no marker the rules recognised, and a
// senior backend resume scored 97 against a new-grad posting.

test("graduate and new-grad titles infer junior", () => {
  for (const title of [
    "New Graduate Software Engineer - Sunnyvale",
    "UK Graduate Software Engineer",
    "Software Engineer, New Grad",
    "New Grad Backend Engineer 2026",
    "Early Career Software Engineer",
    "Campus Hire Software Engineer",
  ]) {
    assert.equal(inferSeniorityLevel(title, ""), "junior", `expected junior for "${title}"`)
  }
})

test("an explicit title still beats an entry-level keyword elsewhere", () => {
  assert.equal(
    inferSeniorityLevel("Staff Software Engineer", "You will mentor our graduate cohort."),
    "staff",
  )
})

// ── Years-of-experience fallback ─────────────────────────────────────────────
// Postings frequently state years instead of a level. Used only when title and
// explicit level labels give nothing.

test("years of experience infer a level when the title is generic", () => {
  assert.equal(inferSeniorityLevel("Software Engineer", "We require 1+ years of experience."), "junior")
  assert.equal(inferSeniorityLevel("Software Engineer", "3-5 years of experience building APIs."), "mid")
  assert.equal(inferSeniorityLevel("Software Engineer", "Minimum of 8 years of experience."), "senior")
})

test("years inference is capped at senior so a generic title is not over-promoted", () => {
  // 12 years on a generic title should not read as principal.
  assert.equal(inferSeniorityLevel("Software Engineer", "12+ years of experience required."), "senior")
})

test("title wins over a conflicting years statement", () => {
  assert.equal(inferSeniorityLevel("Senior Software Engineer", "2 years of experience."), "senior")
  assert.equal(inferSeniorityLevel("Principal Engineer", "5+ years of experience."), "principal")
})

test("no seniority signal at all still returns null", () => {
  assert.equal(inferSeniorityLevel("Software Engineer", "Join our team and build things."), null)
})
