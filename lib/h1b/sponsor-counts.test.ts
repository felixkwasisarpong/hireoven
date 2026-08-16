import { strict as assert } from "node:assert"
import { test } from "node:test"
import { reconcileLcaCounts, rollupSponsorCounts } from "./sponsor-counts"

const years = (entries: Array<[number, number]>) =>
  new Map(entries.map(([year, approved]) => [year, { approved }]))

test("three-year total sums the three most recent years", () => {
  // Real AWS shape: the old code paired 1yr=2901 with an LCA-derived 3yr=0.
  const counts = rollupSponsorCounts(
    years([[2025, 2901], [2024, 2216], [2023, 2104], [2022, 3078], [2021, 2460]]),
    0,
  )
  assert.equal(counts.oneYear, 2901)
  assert.equal(counts.threeYear, 2901 + 2216 + 2104)
})

test("three-year is never below one-year, even with a zero LCA floor", () => {
  const counts = rollupSponsorCounts(years([[2025, 6305]]), 0)
  assert.equal(counts.oneYear, 6305)
  assert.equal(counts.threeYear, 6305)
})

test("LCA total is used as a floor when it exceeds USCIS coverage", () => {
  const counts = rollupSponsorCounts(years([[2025, 10], [2024, 5]]), 900)
  assert.equal(counts.oneYear, 10)
  assert.equal(counts.threeYear, 900)
})

test("uses the three most recent years PRESENT, not calendar-relative years", () => {
  // Latest filing is 2021 — a currentYear-2 window would return zero.
  const counts = rollupSponsorCounts(years([[2021, 40], [2020, 30], [2019, 20], [2018, 99]]), 0)
  assert.equal(counts.oneYear, 40)
  assert.equal(counts.threeYear, 90)
})

test("no USCIS history falls back to the LCA total", () => {
  const counts = rollupSponsorCounts(new Map(), 120)
  assert.equal(counts.oneYear, 0)
  assert.equal(counts.threeYear, 120)
})

test("handles empty input and negative or missing values", () => {
  assert.deepEqual(rollupSponsorCounts(new Map(), null), { oneYear: 0, threeYear: 0 })
  const counts = rollupSponsorCounts(years([[2025, -5], [2024, 12]]), null)
  assert.equal(counts.oneYear, 0)
  assert.equal(counts.threeYear, 12)
})

test("years out of order still resolve the latest correctly", () => {
  const counts = rollupSponsorCounts(years([[2023, 100], [2025, 300], [2024, 200]]), 0)
  assert.equal(counts.oneYear, 300)
  assert.equal(counts.threeYear, 600)
})

test("reconcileLcaCounts keeps the three-year figure at or above one-year", () => {
  assert.deepEqual(reconcileLcaCounts(50, 400), { oneYear: 50, threeYear: 400 })
  // Inconsistent upstream pair gets clamped rather than rendered as impossible.
  assert.deepEqual(reconcileLcaCounts(700, 5), { oneYear: 700, threeYear: 700 })
  assert.deepEqual(reconcileLcaCounts(null, null), { oneYear: 0, threeYear: 0 })
})

test("invariant holds across a spread of shapes", () => {
  const shapes: Array<[Array<[number, number]>, number]> = [
    [[[2026, 1]], 0],
    [[[2026, 0], [2025, 0]], 0],
    [[[2025, 5000], [2024, 1]], 3],
    [[[2024, 7], [2023, 9], [2022, 11], [2021, 13]], 25],
  ]
  for (const [entries, lca] of shapes) {
    const c = rollupSponsorCounts(years(entries), lca)
    assert.ok(c.threeYear >= c.oneYear, `3yr ${c.threeYear} < 1yr ${c.oneYear}`)
  }
})
