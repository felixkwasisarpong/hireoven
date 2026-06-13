import test from "node:test"
import assert from "node:assert/strict"
import {
  inferRequiresAuthorization,
  mentionsSecurityClearanceRequirement,
} from "@/lib/jobs/metadata"

// The exact phrase the system was missing.
test("flags 'Must have at least a current active SECRET clearance'", () => {
  const text = "Responsibilities... Must have at least a current active SECRET clearance. Other duties as assigned."
  assert.equal(mentionsSecurityClearanceRequirement(text), true)
  assert.equal(inferRequiresAuthorization(text), true)
})

test("catches common clearance phrasings", () => {
  const cases = [
    "Active TS/SCI clearance required",
    "Must hold a Top Secret clearance",
    "Ability to obtain a Secret clearance",
    "Applicants must possess a current DoD clearance",
    "Public Trust clearance required",
    "Security clearance is mandatory for this role",
    "Requires a full-scope polygraph clearance",
  ]
  for (const c of cases) {
    assert.equal(mentionsSecurityClearanceRequirement(c), true, `should flag: ${c}`)
    assert.equal(inferRequiresAuthorization(c), true, `auth-required: ${c}`)
  }
})

test("does not flag jobs with no clearance language", () => {
  const text =
    "We are hiring a Senior Software Engineer to build our payments platform. " +
    "Visa sponsorship is available for the right candidate."
  assert.equal(mentionsSecurityClearanceRequirement(text), false)
  // sponsorship-available wins for the auth signal
  assert.equal(inferRequiresAuthorization(text), false)
})

test("does not flag an unrelated use of the word clear", () => {
  const text = "You will help clear our support backlog and clearly document fixes."
  assert.equal(mentionsSecurityClearanceRequirement(text), false)
})
