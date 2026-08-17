import assert from "node:assert/strict"
import { test } from "node:test"
import { computeLevelGap, negotiationLine } from "./level-gap"

// The real published thresholds for SOC 15-1252 in area 47900 (Washington-Arlington-Alexandria),
// wage year 2026-27 — the worked example this feature was verified against.
const RESTON = [102_086, 127_462, 152_838, 178_214] as const

test("the worked example: a $113.4k-$170.2k band is Level I at the floor, Level III at the ceiling", () => {
  const gap = computeLevelGap({ levels: RESTON, salaryMin: 113_400, salaryMax: 170_200 })
  assert.ok(gap)
  assert.equal(gap.currentLevel, 1)
  assert.equal(gap.nextLevel, 2)
  assert.equal(gap.increaseNeeded, 127_462 - 113_400) // $14,062
  assert.equal(gap.nextLevelWithinBand, true)
  assert.equal(gap.bestLevelInBand, 3, "Level III is reachable inside their own advertised range")
  assert.equal(gap.ceilingBelowLevelTwo, false)
  assert.equal(gap.belowPrevailingWage, false)
})

test("a band whose ceiling cannot reach Level II is flagged structurally weak", () => {
  const gap = computeLevelGap({ levels: RESTON, salaryMin: 105_000, salaryMax: 120_000 })
  assert.ok(gap)
  assert.equal(gap.ceilingBelowLevelTwo, true)
  assert.equal(gap.nextLevelWithinBand, false, "no amount of negotiating reaches Level II here")
  assert.equal(negotiationLine(gap), null, "and so we suggest nothing")
})

test("a band floor beneath the Level I prevailing wage is not a sponsorable offer", () => {
  const gap = computeLevelGap({ levels: RESTON, salaryMin: 80_000, salaryMax: 95_000 })
  assert.ok(gap)
  assert.equal(gap.belowPrevailingWage, true)
  assert.equal(gap.currentLevel, 1)
})

test("already at Level IV — no next level, no suggestion", () => {
  const gap = computeLevelGap({ levels: RESTON, salaryMin: 200_000, salaryMax: 240_000 })
  assert.ok(gap)
  assert.equal(gap.currentLevel, 4)
  assert.equal(gap.nextLevel, null)
  assert.equal(gap.increaseNeeded, null)
  assert.equal(negotiationLine(gap), null)
})

test("exactly on a threshold counts as that level, not the one below", () => {
  const gap = computeLevelGap({ levels: RESTON, salaryMin: 127_462, salaryMax: 127_462 })
  assert.ok(gap)
  assert.equal(gap.currentLevel, 2)
})

test("a single figure works — anchor and ceiling collapse to it", () => {
  const gap = computeLevelGap({ levels: RESTON, salaryMin: null, salaryMax: 160_000 })
  assert.ok(gap)
  assert.equal(gap.anchorSalary, 160_000)
  assert.equal(gap.currentLevel, 3)
  assert.equal(gap.nextLevelWithinBand, false, "one figure cannot also be headroom")
})

test("no salary, bad thresholds, or non-ascending thresholds produce nothing", () => {
  assert.equal(computeLevelGap({ levels: RESTON, salaryMin: null, salaryMax: null }), null)
  assert.equal(computeLevelGap({ levels: RESTON, salaryMin: 0, salaryMax: 0 }), null)
  assert.equal(
    computeLevelGap({ levels: [150_000, 120_000, 130_000, 180_000], salaryMin: 100_000, salaryMax: 200_000 }),
    null,
    "non-monotonic thresholds mean bad data — say nothing"
  )
})

test("the negotiation line quotes the threshold and only appears when it is inside the band", () => {
  const gap = computeLevelGap({ levels: RESTON, salaryMin: 113_400, salaryMax: 170_200 })
  assert.ok(gap)
  const line = negotiationLine(gap, "Software Developers")
  assert.ok(line)
  assert.match(line, /\$127,462/)
  assert.match(line, /Level II\b/)
  // The SOC label is a plural occupation category, so it must read as a classification and never
  // as this job's role name ("for the Software Developers role").
  assert.match(line, /classifies under "Software Developers"/)
  assert.doesNotMatch(line, /the Software Developers role/)
})
