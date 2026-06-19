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
