import assert from "node:assert/strict"
import { test } from "node:test"
import { computeFollowThrough, MIN_MATURE_SAMPLE } from "./green-card-followthrough"

test("follow-through is converted / matured total", () => {
  const r = computeFollowThrough({ maturedCertified: 48, maturedExpired: 70 })
  assert.equal(r.maturedTotal, 118)
  assert.equal(r.maturedExpired, 70)
  assert.ok(r.rate !== null)
  assert.equal(Math.round(r.rate * 100), 41)
  assert.equal(r.confidence, "high")
})

// The whole point of the module: a thin sample must not produce a confident-looking percentage.
test("a sample below the floor reports unknown rather than a number", () => {
  const r = computeFollowThrough({ maturedCertified: 2, maturedExpired: 1 })
  assert.equal(r.rate, null)
  assert.equal(r.confidence, "unknown")
  assert.equal(r.maturedTotal, 3)
  assert.ok(r.maturedTotal < MIN_MATURE_SAMPLE)
})

test("an employer with zero matured certifications is unknown, not 0% and not 100%", () => {
  const r = computeFollowThrough({ maturedCertified: 0, maturedExpired: 0 })
  assert.equal(r.rate, null)
  assert.equal(r.confidence, "unknown")
})

test("confidence scales with the matured sample size", () => {
  assert.equal(computeFollowThrough({ maturedCertified: 5, maturedExpired: 2 }).confidence, "low")
  assert.equal(computeFollowThrough({ maturedCertified: 15, maturedExpired: 5 }).confidence, "medium")
  assert.equal(computeFollowThrough({ maturedCertified: 60, maturedExpired: 10 }).confidence, "high")
})

test("perfect and total failure both compute", () => {
  const perfect = computeFollowThrough({ maturedCertified: 40, maturedExpired: 0 })
  assert.equal(perfect.rate, 1)
  const none = computeFollowThrough({ maturedCertified: 0, maturedExpired: 40 })
  assert.equal(none.rate, 0)
})

test("negative and fractional inputs are coerced rather than producing a bogus rate", () => {
  const r = computeFollowThrough({ maturedCertified: -5, maturedExpired: 20.7 })
  assert.equal(r.maturedTotal, 20)
  assert.equal(r.rate, 0)
})
