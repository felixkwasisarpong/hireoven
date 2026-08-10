/**
 * Company time-to-fill.
 *
 * How long a company's roles typically stay open, inferred from the observed
 * posting lifecycle: a job flips is_active=false when the harvester stops seeing
 * it on the board (the role came down). The median of (last_seen_at −
 * first_detected_at) over a company's recently-closed jobs is a robust proxy for
 * "how fast roles here move" — which tells a candidate how urgently to apply.
 *
 * Framed descriptively ("typically open ~N days"), never as a fabricated
 * time-to-hire. `import type { Pool }` only, so the label helper is pure and
 * safe to use client- or server-side; the compute fn takes the pool as an arg.
 */

import type { Pool } from "pg"

// A company needs at least this many recently-closed jobs for a trustworthy
// median; below it we don't store a value and the signal stays hidden.
export const TIME_TO_FILL_MIN_SAMPLE = 5
const LOOKBACK_DAYS = 180

/** Recompute median days-open for every company with enough recently-closed jobs. */
export async function computeAndStoreTimeToFill(pool: Pool): Promise<{ updated: number }> {
  const res = await pool.query(
    `WITH stats AS (
       SELECT company_id,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (last_seen_at - first_detected_at)) / 86400.0
              ) AS median_days,
              COUNT(*)::int AS n
         FROM jobs
        WHERE company_id IS NOT NULL
          AND is_active = false
          AND first_detected_at IS NOT NULL
          AND last_seen_at IS NOT NULL
          AND last_seen_at > first_detected_at
          AND last_seen_at > now() - interval '${LOOKBACK_DAYS} days'
        GROUP BY company_id
       HAVING COUNT(*) >= ${TIME_TO_FILL_MIN_SAMPLE}
     )
     UPDATE companies c
        SET median_days_open        = GREATEST(1, round(stats.median_days))::int,
            time_to_fill_sample     = stats.n,
            time_to_fill_computed_at = now()
       FROM stats
      WHERE c.id = stats.company_id`,
  )
  return { updated: res.rowCount ?? 0 }
}

export interface FillSpeed {
  days: number
  label: string
  tone: "fast" | "medium" | "slow"
}

/**
 * Presentation for the time-to-fill signal. Returns null when there isn't a
 * trustworthy value yet, so callers can simply hide it.
 */
export function fillSpeedLabel(
  medianDaysOpen: number | null | undefined,
  sample: number | null | undefined,
): FillSpeed | null {
  if (medianDaysOpen == null || !sample || sample < TIME_TO_FILL_MIN_SAMPLE) return null
  const days = Math.max(1, Math.round(medianDaysOpen))
  if (days <= 10) return { days, label: `Roles here fill fast — typically open ~${days} days`, tone: "fast" }
  if (days <= 30) return { days, label: `Roles here are typically open ~${days} days`, tone: "medium" }
  return { days, label: `Roles here tend to stay open ~${days} days`, tone: "slow" }
}
