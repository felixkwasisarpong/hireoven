/**
 * Public career-paths aggregates — the transition graph, read back as browsable
 * evidence: "how do people actually move from X to Y?"
 *
 * `career_transitions` (mined by lib/career/transitions) accumulates real
 * role→role moves, each normalized to a field pair. This reads that graph two
 * ways:
 *   - listTopPaths(): the most-travelled field→field moves, for the /paths hub.
 *   - getPathDetail(): one field pair in depth — count, median timing, the real
 *     role→role title moves inside it — for a /paths/[pair] page.
 *
 * Same honesty contract as lib/career/pivot-evidence: nothing surfaces below
 * MIN_SAMPLE distinct people (a pair we can't stand behind stays dark), timing
 * is gated separately since many edges carry no measurable gap, and every field
 * is a straight aggregate — no invented numbers.
 *
 * Server-only (pg).
 */

import type { Pool } from "pg"
import { FIELDS } from "@/lib/resume/signal"
import { MIN_SAMPLE } from "@/lib/career/pivot-evidence"

const LABELS: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]))

/** Human label for a field key, falling back to the key itself. */
export function pathFieldLabel(key: string): string {
  return LABELS[key] ?? key
}

/** URL slug for a field pair: `${from}-to-${to}`. Field keys never contain
 *  hyphens (they use underscores), so this splits back unambiguously on `-to-`. */
export function pathSlug(fromField: string, toField: string): string {
  return `${fromField}-to-${toField}`
}

/** Parse a `${from}-to-${to}` slug back to its field keys, or null if malformed
 *  or either side isn't a real field. */
export function parsePathSlug(slug: string): { fromField: string; toField: string } | null {
  const parts = slug.split("-to-")
  if (parts.length !== 2) return null
  const [fromField, toField] = parts
  if (!fromField || !toField || fromField === toField) return null
  if (!LABELS[fromField] || !LABELS[toField]) return null
  return { fromField, toField }
}

export interface PathSummary {
  fromField: string
  toField: string
  fromLabel: string
  toLabel: string
  slug: string
  /** Distinct people observed making this field→field move. */
  people: number
  /** Median months between the two roles, or null if too few measurable gaps. */
  medianGapMonths: number | null
}

/** One concrete role→role move inside a field pair. */
export interface RoleMove {
  fromTitle: string
  toTitle: string
  count: number
}

export interface PathDetail extends PathSummary {
  /** Share of the edges backed by an actual HireOven hire (higher confidence). */
  hiredOutcomeShare: number
  /** The real, most-common role→role title moves inside this field pair. */
  topRoleMoves: RoleMove[]
}

const num = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v)

type SummaryRow = {
  from_field: string
  to_field: string
  people: string | number | null
  gap_samples: string | number | null
  median_gap: string | number | null
}

function toSummary(r: SummaryRow): PathSummary {
  const people = num(r.people)
  const gapSamples = num(r.gap_samples)
  const medianGap = num(r.median_gap)
  return {
    fromField: r.from_field,
    toField: r.to_field,
    fromLabel: pathFieldLabel(r.from_field),
    toLabel: pathFieldLabel(r.to_field),
    slug: pathSlug(r.from_field, r.to_field),
    people,
    medianGapMonths: gapSamples >= MIN_SAMPLE && medianGap > 0 ? Math.round(medianGap) : null,
  }
}

/**
 * The most-travelled field→field moves, most-people first. Only pairs at or above
 * MIN_SAMPLE distinct people are returned, so the hub is empty until the graph is
 * genuinely meaningful rather than padded with thin, unreliable pairs.
 */
export async function listTopPaths(pool: Pool, limit = 60): Promise<PathSummary[]> {
  const { rows } = await pool.query<SummaryRow>(
    `SELECT
        from_field,
        to_field,
        COUNT(DISTINCT user_id)                                  AS people,
        COUNT(gap_months)                                        AS gap_samples,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_months)  AS median_gap
       FROM career_transitions
      WHERE from_field IS NOT NULL
        AND to_field IS NOT NULL
        AND from_field <> to_field
      GROUP BY from_field, to_field
     HAVING COUNT(DISTINCT user_id) >= $1
      ORDER BY people DESC, from_field, to_field
      LIMIT $2`,
    [MIN_SAMPLE, Math.max(1, Math.min(limit, 500))],
  )
  return rows.map(toSummary)
}

/**
 * One field pair in depth, or null when the graph doesn't yet hold enough real
 * moves to say anything honest. Includes the actual role→role title moves people
 * made inside the pair — the concrete texture behind the aggregate.
 */
export async function getPathDetail(
  pool: Pool,
  fromField: string,
  toField: string,
): Promise<PathDetail | null> {
  if (!fromField || !toField || fromField === toField) return null

  const { rows } = await pool.query<SummaryRow & { hired_edges: string | number | null; total_edges: string | number | null }>(
    `SELECT
        from_field,
        to_field,
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
  if (!r || num(r.people) < MIN_SAMPLE) return null

  const totalEdges = num(r.total_edges)
  const summary = toSummary(r)

  const { rows: moveRows } = await pool.query<{ from_title: string; to_title: string; count: string | number | null }>(
    `SELECT from_title, to_title, COUNT(*) AS count
       FROM career_transitions
      WHERE from_field = $1 AND to_field = $2
      GROUP BY from_title, to_title
      ORDER BY count DESC, from_title
      LIMIT 8`,
    [fromField, toField],
  )

  return {
    ...summary,
    hiredOutcomeShare: totalEdges > 0 ? num(r.hired_edges) / totalEdges : 0,
    topRoleMoves: moveRows.map((m) => ({
      fromTitle: m.from_title,
      toTitle: m.to_title,
      count: num(m.count),
    })),
  }
}
