import test from "node:test"
import assert from "node:assert/strict"
import { classifyCapExempt } from "@/lib/cap-exempt/classify"

const co = (name: string, domain: string | null = null, industry: string | null = null) =>
  classifyCapExempt({ name, domain, industry })

test("Stanford University → high confidence university", () => {
  const r = co("Stanford University", "stanford.edu")
  assert.equal(r.is_cap_exempt, true)
  assert.equal(r.reason, "university")
  assert.equal(r.confidence, "high")
})

test(".edu domain alone → high confidence", () => {
  const r = co("University of Phoenix", "phoenix.edu")
  assert.equal(r.confidence, "high")
  assert.equal(r.source, "edu_domain")
})

test("Argonne National Laboratory → high confidence govt_research", () => {
  const r = co("Argonne National Laboratory", null)
  assert.equal(r.reason, "govt_research")
  assert.equal(r.confidence, "high")
})

test("Broad Institute style research org → low confidence nonprofit_research", () => {
  const r = co("Allen Institute for Brain Research", null)
  assert.equal(r.is_cap_exempt, true)
  assert.equal(r.confidence, "low")
  assert.equal(r.reason, "nonprofit_research")
})

test("Stripe → not cap-exempt", () => {
  const r = co("Stripe", "stripe.com", "Technology")
  assert.equal(r.is_cap_exempt, false)
})

test("for-profit hospital chain is NOT flagged (no nonprofit confirmation)", () => {
  // Conservative v1: generic hospitals aren't flagged to avoid false positives (e.g. HCA).
  const r = co("HCA Healthcare", "hcahealthcare.com", "Healthcare")
  assert.equal(r.is_cap_exempt, false)
})
