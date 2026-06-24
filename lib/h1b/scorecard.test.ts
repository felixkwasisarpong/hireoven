import test from "node:test"
import assert from "node:assert/strict"
import { scoreBucket } from "@/lib/h1b/scorecard"

test("scoreBucket maps each grade boundary deterministically", () => {
  const cases: Array<[number, string]> = [
    [100, "A+"],
    [90, "A+"],
    [89, "A"],
    [80, "A"],
    [79, "B"],
    [70, "B"],
    [69, "C"],
    [60, "C"],
    [59, "D"],
    [40, "D"],
    [39, "F"],
    [0, "F"],
  ]
  for (const [score, grade] of cases) {
    assert.equal(scoreBucket(score).grade, grade, `score ${score} should be ${grade}`)
  }
})

test("scoreBucket clamps non-finite / negative inputs to F", () => {
  assert.equal(scoreBucket(Number.NaN).grade, "F")
  assert.equal(scoreBucket(-10).grade, "F")
})

test("scoreBucket returns a stable hue + non-empty copy for every grade", () => {
  for (const score of [95, 85, 75, 65, 50, 10]) {
    const b = scoreBucket(score)
    assert.ok(b.label.length > 0)
    assert.ok(b.short.length > 0)
    assert.ok(b.description.length > 0)
    assert.ok(["emerald", "green", "blue", "amber", "orange", "red"].includes(b.hue))
  }
})
