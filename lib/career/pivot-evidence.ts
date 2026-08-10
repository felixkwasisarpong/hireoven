/**
 * Pivot evidence — the honest payoff of the transition graph.
 *
 * `career_transitions` (mined by lib/career/transitions) accumulates real
 * role→role moves. Once enough people have actually made a given field→field
 * move, this reads that back as evidence on the bridge: "N people made this
 * move; it typically took ~M months."
 *
 * Deliberately threshold-gated. Below MIN_SAMPLE distinct people we return null,
 * so the UI shows nothing rather than a claim we can't stand behind — the whole
 * point is that this stays dark until the graph is genuinely meaningful. The
 * timing line is gated separately (many edges have no measurable gap), so we can
 * report the count honestly even when we can't yet report a duration.
 *
 * Server-only (pg). Never invents numbers — every field is a straight aggregate.
 */

import type { Pool } from "pg"

/** Minimum distinct people before we'll surface anything at all. */
export const MIN_SAMPLE = 20

export interface PivotEvidence {
  fromField: string
  toField: string
  /** Distinct people observed making this exact field→field move. */
  sampleSize: number
  /** Median months between the two roles, or null if too few measurable gaps. */
  medianGapMonths: number | null
  /** Share of the edges backed by an actual HireOven hire (higher confidence). */
  hiredOutcomeShare: number
}

type Row = {
  people: string | number | null
  gap_samples: string | number | null
  median_gap: string | number | null
  hired_edges: string | number | null
  total_edges: string | number | null
}

const num = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v)

/**
 * Evidence for a single field→field pivot, or null when the graph doesn't yet
 * hold enough real moves to say anything honest.
 */
export async function getPivotEvidence(
  pool: Pool,
  fromField: string,
  toField: string,
): Promise<PivotEvidence | null> {
  if (!fromField || !toField || fromField === toField) return null

  const { rows } = await pool.query<Row>(
    `SELECT
        COUNT(DISTINCT user_id)                                  AS people,
        COUNT(gap_months)                                        AS gap_samples,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_months)  AS median_gap,
        COUNT(*) FILTER (WHERE source = 'hired_outcome')         AS hired_edges,
        COUNT(*)                                                 AS total_edges
       FROM career_transitions
      WHERE from_field = $1 AND to_field = $2`,
    [fromField, toField],
  )

  const r = rows[0]
  const people = num(r?.people)
  if (people < MIN_SAMPLE) return null

  const gapSamples = num(r?.gap_samples)
  const medianGap = num(r?.median_gap)
  const totalEdges = num(r?.total_edges)

  return {
    fromField,
    toField,
    sampleSize: people,
    // Only report a duration once enough moves carry a measurable gap.
    medianGapMonths: gapSamples >= MIN_SAMPLE && medianGap > 0 ? Math.round(medianGap) : null,
    hiredOutcomeShare: totalEdges > 0 ? num(r?.hired_edges) / totalEdges : 0,
  }
}
