import assert from "node:assert/strict"
import { test } from "node:test"
import { applicableRules, feeVerdict, lotteryVerdict, durationOfStatusVerdict } from "./rules"

test("the $100k fee does NOT apply when filing a change of status inside the US", () => {
  const v = feeVerdict({ status: "opt", filingContext: "change_of_status_in_us" })
  assert.equal(v.applicability, "does_not_apply")
  assert.match(v.meaning, /does NOT apply|not aimed/i)
})

test("the $100k fee applies for consular processing outside the US", () => {
  const v = feeVerdict({ status: "other", filingContext: "consular_outside_us" })
  assert.equal(v.applicability, "applies")
})

test("unknown filing context → maybe, with a nudge to confirm", () => {
  const v = feeVerdict({ status: "opt", filingContext: "unknown" })
  assert.equal(v.applicability, "maybe")
})

test("wage lottery applies to cap-subject, not to the cap-exempt path", () => {
  assert.equal(lotteryVerdict({ status: "opt", filingContext: "unknown" }).applicability, "applies")
  assert.equal(
    lotteryVerdict({ status: "opt", filingContext: "unknown", capExemptPath: true }).applicability,
    "does_not_apply"
  )
})

test("D/S rule applies to F-1 students (incl. OPT / STEM OPT), not others", () => {
  for (const status of ["f1_student", "opt", "stem_opt"] as const) {
    assert.equal(durationOfStatusVerdict({ status, filingContext: "unknown" }).applicability, "applies")
  }
  assert.equal(durationOfStatusVerdict({ status: "other", filingContext: "unknown" }).applicability, "does_not_apply")
})

test("applicableRules returns all three verdicts in priority order", () => {
  const rules = applicableRules({ status: "stem_opt", filingContext: "change_of_status_in_us" })
  assert.equal(rules.length, 3)
  assert.deepEqual(rules.map((r) => r.key), ["wage_lottery", "duration_of_status", "fee_100k"])
})

test("the reassuring student case: lottery hits, D/S hits, fee does not", () => {
  const rules = applicableRules({ status: "opt", filingContext: "change_of_status_in_us" })
  const byKey = Object.fromEntries(rules.map((r) => [r.key, r.applicability]))
  assert.equal(byKey.wage_lottery, "applies")
  assert.equal(byKey.duration_of_status, "applies")
  assert.equal(byKey.fee_100k, "does_not_apply")
})
