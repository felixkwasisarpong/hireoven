import assert from "node:assert/strict"
import { test } from "node:test"
import { isRealEndClient } from "./placement-graph"

// SECONDARY_ENTITY_BUSINESS_NAME is free text. Every rejected value below is a real high-volume
// entry from the FY2026 Q3 file — without this filter the product would claim a staffing firm
// "places workers at Home Address".
test("worksite descriptions are not end clients", () => {
  for (const junk of [
    "beneficiary s residence",
    "beneficiary residence",
    "home address",
    "home office",
    "home",
    "remote",
    "remote location",
    "various locations",
    "client location",
    "end client",
    "n a",
    "none",
    "unknown",
    "confidential",
    "same as employer",
    "work from home",
    "united states",
  ]) {
    assert.equal(isRealEndClient(junk), false, `"${junk}" must be rejected`)
  }
})

test("real companies pass", () => {
  for (const name of [
    "bank of america",
    "fidelity investments",
    "apple",
    "google",
    "jp morgan chase",
    "at&t",
    "cvs health",
    "johnson & johnson",
    "renewal rehab",
  ]) {
    assert.equal(isRealEndClient(name), true, `"${name}" must be accepted`)
  }
})

test("empty, single-character and numeric values are rejected", () => {
  for (const v of ["", " ", "a", "1", "12345", null, undefined]) {
    assert.equal(isRealEndClient(v), false, `${JSON.stringify(v)} must be rejected`)
  }
})

test("a company whose name merely contains a stop-word is not rejected", () => {
  // The patterns are anchored, so these must survive.
  assert.equal(isRealEndClient("remote technologies inc"), true)
  assert.equal(isRealEndClient("home depot"), true)
  assert.equal(isRealEndClient("american home shield"), true)
  assert.equal(isRealEndClient("client first financial"), true)
})
