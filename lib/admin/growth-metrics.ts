/**
 * Growth metrics for the admin dashboard — the plan's North Star table, built
 * from real data. Six of the seven metrics come straight from Postgres; website
 * visitors is external (Vercel Analytics) and is surfaced as untracked rather
 * than faked.
 *
 * All days are UTC, matching the rest of the admin stats layer.
 */

import type { Pool } from "pg"

export type MetricUnit = "count" | "percent"

export interface MetricPoint {
  day: string // YYYY-MM-DD (UTC)
  value: number
}

export interface GrowthMetric {
  key: string
  label: string
  unit: MetricUnit
  /** Today's value (UTC), or null when the metric isn't tracked here. */
  today: number | null
  /** Plan target (per day, or a percentage). */
  target: number
  /** Daily series over the window, oldest → newest. Empty when untracked. */
  series: MetricPoint[]
  /** Average per day over the window (for count metrics). */
  average: number | null
  /** False when the number lives in an external system (e.g. Vercel Analytics). */
  tracked: boolean
  /** Where an untracked metric actually lives. */
  source?: string
}

export interface GrowthMetrics {
  generatedAt: string
  windowDays: number
  metrics: GrowthMetric[]
}

/** Build an ascending list of the last `days` UTC calendar days as YYYY-MM-DD. */
function dateSpine(days: number): string[] {
  const out: string[] = []
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(todayUtc - i * 86_400_000).toISOString().slice(0, 10))
  }
  return out
}

/** Map [{day, n}] rows onto the spine, filling missing days with 0. */
function toSeries(spine: string[], rows: Array<{ day: string; n: number }>): MetricPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, Number(r.n) || 0]))
  return spine.map((day) => ({ day, value: byDay.get(day) ?? 0 }))
}

function avg(series: MetricPoint[]): number {
  if (series.length === 0) return 0
  return Math.round(series.reduce((s, p) => s + p.value, 0) / series.length)
}

function todayValue(series: MetricPoint[]): number {
  return series[series.length - 1]?.value ?? 0
}

// Per-day count grouped by a timestamp column, over the window.
async function dailyCount(
  pool: Pool,
  table: string,
  tsColumn: string,
  startIso: string,
): Promise<Array<{ day: string; n: number }>> {
  const { rows } = await pool.query<{ day: string; n: string }>(
    `SELECT to_char(date_trunc('day', ${tsColumn} AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
            COUNT(*)::text AS n
       FROM ${table}
      WHERE ${tsColumn} >= $1::timestamptz
      GROUP BY 1`,
    [startIso],
  )
  return rows.map((r) => ({ day: r.day, n: Number(r.n) }))
}

// Per-day SUM of a numeric session column from user_session_quality.
async function dailySessionSum(
  pool: Pool,
  column: string,
  startIso: string,
): Promise<Array<{ day: string; n: number }>> {
  const { rows } = await pool.query<{ day: string; n: string }>(
    `SELECT to_char(date_trunc('day', session_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(${column}), 0)::text AS n
       FROM user_session_quality
      WHERE session_at >= $1::timestamptz
      GROUP BY 1`,
    [startIso],
  )
  return rows.map((r) => ({ day: r.day, n: Number(r.n) }))
}

type DayCount = { day: string; n: number }
const emptyDayCounts = (): DayCount[] => []

export async function buildGrowthMetrics(pool: Pool, windowDays = 14): Promise<GrowthMetrics> {
  const spine = dateSpine(windowDays)
  const startIso = new Date(`${spine[0]}T00:00:00.000Z`).toISOString()

  // Each source query is independent — run them together. A missing table (e.g.
  // user_session_quality not yet migrated) shouldn't blank the whole board, so
  // each falls back to an empty series.
  const [signups, emailSubs, referrals, searches, applyClicks, returningRows] = await Promise.all([
    dailyCount(pool, "profiles", "created_at", startIso).catch(emptyDayCounts),
    dailyCount(pool, "marketing_subscribers", "created_at", startIso).catch(emptyDayCounts),
    dailyCount(pool, "referrals", "created_at", startIso).catch(emptyDayCounts),
    dailySessionSum(pool, "search_queries", startIso).catch(emptyDayCounts),
    dailySessionSum(pool, "apply_attempts", startIso).catch(emptyDayCounts),
    pool
      .query<{ day: string; returning: string; active: string }>(
        `SELECT to_char(date_trunc('day', usq.session_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                COUNT(DISTINCT usq.user_id) FILTER (
                  WHERE p.created_at::date < (usq.session_at AT TIME ZONE 'UTC')::date
                )::text AS returning,
                COUNT(DISTINCT usq.user_id)::text AS active
           FROM user_session_quality usq
           JOIN profiles p ON p.id = usq.user_id
          WHERE usq.session_at >= $1::timestamptz
          GROUP BY 1`,
        [startIso],
      )
      .then((r) => r.rows)
      .catch(() => [] as Array<{ day: string; returning: string; active: string }>),
  ])

  const signupSeries = toSeries(spine, signups)
  const emailSeries = toSeries(spine, emailSubs)
  const referralSeries = toSeries(spine, referrals)
  const searchSeries = toSeries(spine, searches)
  const applySeries = toSeries(spine, applyClicks)

  // Returning rate (%) per day = returning / active active-users that day.
  const returningByDay = new Map(
    returningRows.map((r) => {
      const active = Number(r.active) || 0
      const ret = Number(r.returning) || 0
      return [r.day, active > 0 ? Math.round((ret / active) * 100) : 0]
    }),
  )
  const returningSeries: MetricPoint[] = spine.map((day) => ({ day, value: returningByDay.get(day) ?? 0 }))

  const metrics: GrowthMetric[] = [
    {
      key: "visitors",
      label: "Website visitors",
      unit: "count",
      today: null,
      target: 1000,
      series: [],
      average: null,
      tracked: false,
      source: "Vercel Analytics",
    },
    {
      key: "signups",
      label: "New signups",
      unit: "count",
      today: todayValue(signupSeries),
      target: 100,
      series: signupSeries,
      average: avg(signupSeries),
      tracked: true,
    },
    {
      key: "searches",
      label: "Searches performed",
      unit: "count",
      today: todayValue(searchSeries),
      target: 300,
      series: searchSeries,
      average: avg(searchSeries),
      tracked: true,
    },
    {
      key: "apply_clicks",
      label: "Job applications clicked",
      unit: "count",
      today: todayValue(applySeries),
      target: 500,
      series: applySeries,
      average: avg(applySeries),
      tracked: true,
    },
    {
      key: "returning",
      label: "Returning users",
      unit: "percent",
      today: todayValue(returningSeries),
      target: 40,
      series: returningSeries,
      average: avg(returningSeries),
      tracked: true,
    },
    {
      key: "referrals",
      label: "Referral signups",
      unit: "count",
      today: todayValue(referralSeries),
      target: 20,
      series: referralSeries,
      average: avg(referralSeries),
      tracked: true,
    },
    {
      key: "email_subscribers",
      label: "Email subscribers",
      unit: "count",
      today: todayValue(emailSeries),
      target: 50,
      series: emailSeries,
      average: avg(emailSeries),
      tracked: true,
    },
  ]

  return { generatedAt: new Date().toISOString(), windowDays, metrics }
}
