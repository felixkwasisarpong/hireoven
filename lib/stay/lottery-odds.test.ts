import assert from "node:assert/strict"
import { test } from "node:test"
import {
  computeLotteryOdds,
  cumulativeOdds,
  estimateWageLevel,
  nextLevelTarget,
  optCyclesFor,
  remainingCapSeasons,
  WAGE_LEVEL_META,
} from "./lottery-odds"

test("estimateWageLevel maps salary bands to Level I–IV (national fallback)", () => {
  assert.equal(estimateWageLevel({ salary: 70_000 })?.level, 1)
  assert.equal(estimateWageLevel({ salary: 100_000 })?.level, 2)
  assert.equal(estimateWageLevel({ salary: 140_000 })?.level, 3)
  assert.equal(estimateWageLevel({ salary: 200_000 })?.level, 4)
})

test("estimateWageLevel reports confidence: estimated vs modeled", () => {
  assert.equal(estimateWageLevel({ salary: 90_000 })?.confidence, "estimated")
  assert.equal(
    estimateWageLevel({ salary: 90_000, prevailingWageBands: [80_000, 110_000, 150_000] })?.confidence,
    "modeled"
  )
})

test("estimateWageLevel uses real prevailing-wage cutoffs when provided", () => {
  // Same $90k salary lands differently depending on the local wage distribution.
  assert.equal(estimateWageLevel({ salary: 90_000, prevailingWageBands: [95_000, 120_000, 160_000] })?.level, 1)
  assert.equal(estimateWageLevel({ salary: 90_000, prevailingWageBands: [70_000, 100_000, 140_000] })?.level, 2)
})

test("estimateWageLevel returns null with no usable salary", () => {
  assert.equal(estimateWageLevel({ salary: null }), null)
  assert.equal(estimateWageLevel({ salary: 0 }), null)
  assert.equal(estimateWageLevel({ salary: -5 }), null)
})

test("cumulativeOdds compounds independent draws and is bounded", () => {
  assert.ok(Math.abs(cumulativeOdds(0.15, 1) - 0.15) < 1e-9)
  // 1 - 0.85^3 = 0.385875
  assert.ok(Math.abs(cumulativeOdds(0.15, 3) - 0.385875) < 1e-9)
  assert.equal(cumulativeOdds(0.5, 0), 0)
  assert.equal(cumulativeOdds(2, 3), 1) // clamped
  assert.equal(cumulativeOdds(-1, 3), 0) // clamped
})

test("optCyclesFor: STEM gets more attempts than standard OPT", () => {
  assert.equal(optCyclesFor(true), 3)
  assert.equal(optCyclesFor(false), 1)
  assert.ok(optCyclesFor(true) > optCyclesFor(false))
})

test("computeLotteryOdds: Level I new-grad is the five-alarm case", () => {
  const o = computeLotteryOdds({ salary: 72_000, isStem: false })
  assert.ok(o)
  assert.equal(o!.level, 1)
  assert.equal(o!.singleDrawPct, 15)
  assert.equal(o!.cumulativePct, 15) // non-STEM = 1 cycle
  assert.equal(o!.legacySingleDrawPct, 35) // the "it used to be ~35%" comparison
})

test("computeLotteryOdds: STEM stacks cycles into better cumulative odds", () => {
  const o = computeLotteryOdds({ salary: 72_000, isStem: true })
  assert.equal(o!.singleDrawPct, 15)
  assert.equal(o!.cumulativePct, 39) // round(1 - 0.85^3)
  assert.ok(o!.cumulativePct > o!.singleDrawPct)
})

test("computeLotteryOdds: higher wage level → materially better odds", () => {
  const l1 = computeLotteryOdds({ salary: 72_000, isStem: false })!
  const l3 = computeLotteryOdds({ salary: 140_000, isStem: false })!
  assert.ok(l3.singleDrawPct > l1.singleDrawPct)
  assert.equal(l3.singleDrawPct, 45)
})

test("remainingCapSeasons counts March registration windows inside the runway", () => {
  const asOf = new Date("2026-07-23T00:00:00Z")
  // Standard OPT ending before next March → zero attempts left.
  assert.equal(remainingCapSeasons({ asOf, runwayEndISO: "2027-02-01" }), 0)
  // Ends just after one March → one attempt.
  assert.equal(remainingCapSeasons({ asOf, runwayEndISO: "2027-03-15" }), 1)
  // STEM-length runway (~3 years) → three March windows.
  assert.equal(remainingCapSeasons({ asOf, runwayEndISO: "2029-06-01" }), 3)
})

test("remainingCapSeasons is zero for missing/past runway", () => {
  const asOf = new Date("2026-07-23T00:00:00Z")
  assert.equal(remainingCapSeasons({ asOf, runwayEndISO: null }), 0)
  assert.equal(remainingCapSeasons({ asOf, runwayEndISO: "2025-01-01" }), 0)
})

test("nextLevelTarget: a Level-I role shows the salary + odds jump to Level II", () => {
  const t = nextLevelTarget({ salary: 72_000, isStem: false })
  assert.ok(t)
  assert.equal(t!.currentLevel, 1)
  assert.equal(t!.nextLevel, 2)
  assert.equal(t!.salaryNeeded, 85_000) // national L2 band cutoff
  assert.equal(t!.salaryGap, 13_000)
  assert.equal(t!.currentSingleDrawPct, 15)
  assert.equal(t!.nextSingleDrawPct, 30)
  assert.ok(t!.cumulativeDeltaPct > 0)
})

test("nextLevelTarget: Level IV has no next level", () => {
  assert.equal(nextLevelTarget({ salary: 220_000, isStem: true }), null)
  assert.equal(nextLevelTarget({ salary: null, isStem: true }), null)
})

test("nextLevelTarget respects real prevailing-wage cutoffs", () => {
  const t = nextLevelTarget({ salary: 90_000, isStem: false, prevailingWageBands: [95_000, 120_000, 160_000] })
  assert.equal(t!.currentLevel, 1)
  assert.equal(t!.salaryNeeded, 95_000)
})

test("weighted odds increase monotonically with wage level", () => {
  const odds = [1, 2, 3, 4].map((lvl) => WAGE_LEVEL_META[lvl as 1 | 2 | 3 | 4].singleDrawOdds)
  for (let i = 1; i < odds.length; i += 1) {
    assert.ok(odds[i] > odds[i - 1])
  }
})
