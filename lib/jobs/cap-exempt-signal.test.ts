import test from "node:test"
import assert from "node:assert/strict"
import { capExemptDetectionToSignal, detectCapExemptSignal } from "@/lib/jobs/cap-exempt-signal"

test("detectCapExemptSignal flags university employers as higher education", () => {
  const result = detectCapExemptSignal({ name: "Example State University", industry: "Education" })

  assert.equal(result.possibleCapExempt, true)
  assert.equal(result.category, "higher_education")
  assert.equal(result.confidence, "high")
  assert.ok(result.reasons.some((reason) => /university/i.test(reason)))
})

test("detectCapExemptSignal flags nonprofit research foundations cautiously", () => {
  const result = detectCapExemptSignal({ name: "Cancer Research Foundation", industry: "Nonprofit research" })

  assert.equal(result.possibleCapExempt, true)
  assert.equal(result.category, "nonprofit_research")
  assert.equal(result.confidence, "medium")
  assert.ok(result.warnings.some((warning) => /verified/i.test(warning)))
})

test("detectCapExemptSignal flags national laboratories", () => {
  const result = detectCapExemptSignal({ name: "Pacific National Laboratory", domain: "pnl.gov" })

  assert.equal(result.possibleCapExempt, true)
  assert.equal(result.category, "national_laboratory")
  assert.equal(result.confidence, "high")
})

test("detectCapExemptSignal treats standalone hospital wording as low confidence", () => {
  const result = detectCapExemptSignal({ name: "Children's Hospital of Example City" })

  assert.equal(result.possibleCapExempt, true)
  assert.equal(result.category, "academic_medical_center")
  assert.equal(result.confidence, "low")
  assert.ok(result.warnings.some((warning) => /university affiliation is not confirmed/i.test(warning)))
})

test("detectCapExemptSignal raises confidence for university-affiliated hospitals", () => {
  const result = detectCapExemptSignal(
    { name: "Example Medical Center" },
    { description: "Academic medical center affiliated with Example University." }
  )

  assert.equal(result.possibleCapExempt, true)
  assert.equal(result.category, "higher_education")
  assert.equal(result.confidence, "high")
  assert.ok(result.reasons.some((reason) => /academic/i.test(reason) || /university/i.test(reason)))
})

test("detectCapExemptSignal returns unknown for regular employers", () => {
  const result = detectCapExemptSignal({ name: "Acme Software Inc", industry: "Technology" })

  assert.equal(result.possibleCapExempt, false)
  assert.equal(result.category, "unknown")
  assert.equal(result.confidence, "unknown")
  assert.ok(result.warnings.some((warning) => /No cap-exempt-friendly/i.test(warning)))
})

test("capExemptDetectionToSignal uses possible language", () => {
  const signal = capExemptDetectionToSignal(
    detectCapExemptSignal({ name: "Example Research Institute" })
  )

  assert.equal(signal.isLikelyCapExempt, true)
  assert.ok(signal.likelihood === "likely" || signal.likelihood === "possible")
  assert.match(signal.summary ?? "", /cap-exempt likelihood/i)
  assert.doesNotMatch(signal.summary ?? "", /guaranteed/i)
})
