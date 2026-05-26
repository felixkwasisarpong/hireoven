import test from "node:test"
import assert from "node:assert/strict"
import {
  hasUsableMatchScore,
  normalizeMatchScore,
  resolveOverallMatchScore,
} from "@/lib/jobs/match-score-display"

test("normalizeMatchScore clamps and rounds valid values", () => {
  assert.equal(normalizeMatchScore(87.7), 88)
  assert.equal(normalizeMatchScore(-5), 0)
  assert.equal(normalizeMatchScore(120), 100)
  assert.equal(normalizeMatchScore("42"), 42)
})

test("hasUsableMatchScore only returns true when overall_score is parseable", () => {
  assert.equal(hasUsableMatchScore(null), false)
  assert.equal(hasUsableMatchScore(undefined), false)
  assert.equal(hasUsableMatchScore({}), false)
  assert.equal(hasUsableMatchScore({ overall_score: null }), false)
  assert.equal(hasUsableMatchScore({ overall_score: Number.NaN }), false)
  assert.equal(hasUsableMatchScore({ overall_score: 73 }), true)
})

test("resolveOverallMatchScore keeps fallback precedence", () => {
  assert.equal(
    resolveOverallMatchScore({
      preferredScore: { overall_score: 81 },
      rawData: { matchScore: 55 },
    }),
    81
  )
  assert.equal(
    resolveOverallMatchScore({
      preferredScore: null,
      rawData: { matchScore: 55 },
    }),
    55
  )
})
