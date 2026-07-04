import test from "node:test"
import assert from "node:assert/strict"
import { inferRequiresAuthorization } from "@/lib/jobs/metadata"

// F1 OPT, STEM OPT and H-1B holders are all "legally authorized to work", so
// bare authorization boilerplate must NOT be flagged as "No sponsorship".
test("does NOT flag bare 'authorized to work' boilerplate", () => {
  const cases = [
    "Applicants for U.S.-based positions with WellSky must be legally authorized to work in the United States.",
    "Candidates must be authorized to work in the US.",
    "You must be eligible to work in the United States.",
    "Proof of work authorization will be required upon hire.",
    "Must be currently authorized to work in the country where the job is located.",
  ]
  for (const c of cases) {
    assert.notEqual(inferRequiresAuthorization(c), true, `should NOT flag: ${c}`)
  }
})

// Explicit sponsorship blockers must still be caught.
test("still flags explicit no-sponsorship / citizenship language", () => {
  const cases = [
    "Must be authorized to work in the US without sponsorship now or in the future.",
    "We are unable to provide visa sponsorship for this role.",
    "This position does not offer sponsorship.",
    "No visa sponsorship is available.",
    "Sponsorship is not available for this position.",
    "The employer will not sponsor applicants for work visas.",
    "Applicants must be U.S. citizens.",
    "U.S. Citizenship is required for this role.",
  ]
  for (const c of cases) {
    assert.equal(inferRequiresAuthorization(c), true, `should flag: ${c}`)
  }
})

// Sponsorship-available language wins.
test("does not flag when sponsorship is offered", () => {
  assert.equal(
    inferRequiresAuthorization("Visa sponsorship is available for the right candidate."),
    false,
  )
})
