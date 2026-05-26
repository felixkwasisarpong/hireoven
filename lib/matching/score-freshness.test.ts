import { strict as assert } from "node:assert"
import { test } from "node:test"
import { FAST_SCORE_CACHE_EPOCH_ISO, isScoreFreshForResume } from "./score-freshness"

function plusMs(iso: string, deltaMs: number): string {
  return new Date(Date.parse(iso) + deltaMs).toISOString()
}

test("isScoreFreshForResume: accepts fresh score with matching resume version", () => {
  const resumeUpdatedAt = plusMs(FAST_SCORE_CACHE_EPOCH_ISO, 1_000)
  const computedAt = plusMs(resumeUpdatedAt, 1_000)

  assert.equal(
    isScoreFreshForResume({
      computedAt,
      resumeUpdatedAt,
      scoreResumeVersion: 123,
      currentResumeVersion: 123,
    }),
    true
  )
})

test("isScoreFreshForResume: rejects score older than algorithm epoch", () => {
  const resumeUpdatedAt = plusMs(FAST_SCORE_CACHE_EPOCH_ISO, -10_000)
  const computedAt = plusMs(FAST_SCORE_CACHE_EPOCH_ISO, -1_000)

  assert.equal(
    isScoreFreshForResume({
      computedAt,
      resumeUpdatedAt,
    }),
    false
  )
})

test("isScoreFreshForResume: rejects score older than resume update", () => {
  const resumeUpdatedAt = plusMs(FAST_SCORE_CACHE_EPOCH_ISO, 5_000)
  const computedAt = plusMs(resumeUpdatedAt, -1_000)

  assert.equal(
    isScoreFreshForResume({
      computedAt,
      resumeUpdatedAt,
    }),
    false
  )
})

test("isScoreFreshForResume: rejects mismatched resume version", () => {
  const resumeUpdatedAt = plusMs(FAST_SCORE_CACHE_EPOCH_ISO, 1_000)
  const computedAt = plusMs(resumeUpdatedAt, 1_000)

  assert.equal(
    isScoreFreshForResume({
      computedAt,
      resumeUpdatedAt,
      scoreResumeVersion: 111,
      currentResumeVersion: 222,
    }),
    false
  )
})
