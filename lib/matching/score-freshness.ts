/**
 * Single source of truth for fast-score cache freshness.
 *
 * Bump FAST_SCORE_CACHE_EPOCH_ISO whenever fast scoring logic changes in a way
 * that should invalidate historical rows.
 */
export const FAST_SCORE_CACHE_EPOCH_ISO = "2026-06-18T23:38:07.000Z"
export const FAST_SCORE_CACHE_EPOCH_MS = Date.parse(FAST_SCORE_CACHE_EPOCH_ISO)

if (!Number.isFinite(FAST_SCORE_CACHE_EPOCH_MS)) {
  throw new Error("Invalid FAST_SCORE_CACHE_EPOCH_ISO")
}

type FreshnessInput = {
  computedAt: string
  resumeUpdatedAt: string
  scoreResumeVersion?: number | null
  currentResumeVersion?: number | null
}

/**
 * A score is fresh only when:
 * - it was computed after the current scoring-epoch stamp,
 * - it is newer than (or equal to) the source resume's updated_at,
 * - and, when provided, the persisted resume version matches the current one.
 */
export function isScoreFreshForResume(input: FreshnessInput): boolean {
  const computedAtMs = Date.parse(input.computedAt)
  if (!Number.isFinite(computedAtMs)) return false
  if (computedAtMs < FAST_SCORE_CACHE_EPOCH_MS) return false

  const resumeUpdatedAtMs = Date.parse(input.resumeUpdatedAt)
  if (!Number.isFinite(resumeUpdatedAtMs)) return false
  if (computedAtMs < resumeUpdatedAtMs) return false

  if (
    input.scoreResumeVersion != null &&
    input.currentResumeVersion != null &&
    input.scoreResumeVersion !== input.currentResumeVersion
  ) {
    return false
  }

  return true
}
