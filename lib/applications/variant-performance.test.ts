import test from "node:test"
import assert from "node:assert/strict"
import { computeVariantPerformance, type VariantApplication } from "@/lib/applications/variant-performance"

function rows(resumeId: string, name: string, apps: number, responses: number): VariantApplication[] {
  return Array.from({ length: apps }, (_, i) => ({ resumeId, resumeName: name, gotResponse: i < responses }))
}

test("ranks variants by response rate and computes rates", () => {
  const r = computeVariantPerformance([...rows("a", "Resume A", 10, 2), ...rows("b", "Resume B", 10, 5)])
  assert.equal(r.variants[0].resumeId, "b")
  assert.equal(r.variants[0].responseRate, 0.5)
  assert.equal(r.variants[1].responseRate, 0.2)
  assert.equal(r.totalApplications, 20)
})

test("crowns a confident winner with the lift headline", () => {
  const r = computeVariantPerformance([...rows("a", "Resume A", 12, 2), ...rows("b", "Resume B", 12, 6)])
  assert.ok(r.recommendation)
  assert.equal(r.recommendation!.leaderId, "b")
  assert.equal(r.recommendation!.confident, true)
  assert.equal(r.recommendation!.liftVsRunnerUp, 3) // 50% vs 16.7%
  assert.match(r.recommendation!.headline, /3×|3x/i)
  assert.equal(r.comparable, true)
})

test("does not crown a winner when the gap is small", () => {
  const r = computeVariantPerformance([...rows("a", "Resume A", 10, 4), ...rows("b", "Resume B", 10, 5)])
  assert.equal(r.recommendation!.confident, false) // 1.25x < 1.5x
})

test("a small-sample fluke never outranks an established variant", () => {
  const r = computeVariantPerformance([...rows("a", "Resume A", 20, 6), ...rows("b", "Resume B", 1, 1)])
  assert.equal(r.variants[0].resumeId, "a", "established variant ranks first despite lower rate")
  assert.equal(r.comparable, false) // B has < MIN_SAMPLE
})

test("no recommendation until the leader clears the sample floor", () => {
  const r = computeVariantPerformance([...rows("a", "Resume A", 3, 2), ...rows("b", "Resume B", 2, 0)])
  assert.equal(r.recommendation, null)
})

test("handles a single variant gracefully", () => {
  const r = computeVariantPerformance(rows("a", "Resume A", 8, 3))
  assert.equal(r.variants.length, 1)
  assert.equal(r.comparable, false)
  assert.match(r.recommendation!.headline, /apply with another variant/i)
})
