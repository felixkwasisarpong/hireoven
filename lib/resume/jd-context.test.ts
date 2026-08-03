import test from "node:test"
import assert from "node:assert/strict"
import { detectJdDomains, resolveTargetTitle } from "@/lib/resume/jd-context"

const WORLDPAC_JD = `AI Engineer
Worldpac, a leader in automotive parts distribution, is seeking an AI Engineer.
Partner with teams in Finance, Inventory, Procurement, Operations.
Build API services (FastAPI) integrating with enterprise systems (AS400/IBM i, Salesforce, Oracle).`

test("detectJdDomains finds B2B/distribution, automotive, and enterprise adjacencies", () => {
  const labels = detectJdDomains(WORLDPAC_JD).map((d) => d.label)
  assert.ok(labels.includes("B2B / distribution"), `got: ${labels.join(", ")}`)
  assert.ok(labels.includes("automotive / parts"), `got: ${labels.join(", ")}`)
  assert.ok(labels.includes("enterprise / internal tooling"), `got: ${labels.join(", ")}`)
})

test("detectJdDomains returns empty for a domain-free posting", () => {
  assert.deepEqual(detectJdDomains("We want a great engineer who writes clean code."), [])
})

test("resolveTargetTitle prefers an explicit title", () => {
  assert.equal(resolveTargetTitle(WORLDPAC_JD, "Senior AI Engineer"), "Senior AI Engineer")
})

test("resolveTargetTitle extracts the title from the JD when none is given", () => {
  assert.equal(resolveTargetTitle(WORLDPAC_JD, null), "AI Engineer")
  assert.equal(
    resolveTargetTitle("Backend Software Engineer\nWe are hiring.", null),
    "Backend Software Engineer"
  )
})

test("resolveTargetTitle returns null when no role is present", () => {
  assert.equal(resolveTargetTitle("Join our amazing team of builders!", null), null)
})
