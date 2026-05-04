import { getPostgresPool } from "@/lib/postgres/server"

const CHECKIN_WEIGHTS: Record<string, number> = {
  day_30: 0.5,
  day_90: 0.8,
  day_180: 1.0,
  day_365: 1.0,
  exit: 1.2,
  voluntary: 0.9,
}

type CheckinRow = {
  id: string
  company_id: string | null
  checkin_type: string
  satisfaction_score: number | null
  would_recommend: boolean | null
  compensation_accurate: boolean | null
  role_as_described: boolean | null
  culture_as_described: boolean | null
  red_flags_found: boolean | null
  planning_to_leave: boolean | null
  responses: Record<string, unknown>
}

export async function extractEmployerSignals(checkinId: string): Promise<void> {
  const pool = getPostgresPool()

  const result = await pool.query<CheckinRow>(
    `SELECT id, company_id, checkin_type, satisfaction_score, would_recommend,
            compensation_accurate, role_as_described, culture_as_described,
            red_flags_found, planning_to_leave, responses
     FROM public.post_hire_checkins WHERE id = $1`,
    [checkinId]
  )

  const c = result.rows[0]
  if (!c || !c.company_id) return

  const weight = CHECKIN_WEIGHTS[c.checkin_type] ?? 1.0
  const source = `${c.checkin_type}_checkin`

  type SignalInsert = { type: string; value: number }
  const signals: SignalInsert[] = []

  if (c.satisfaction_score !== null) {
    signals.push({ type: "satisfaction", value: c.satisfaction_score / 5 })
  }

  if (c.would_recommend !== null) {
    signals.push({ type: "satisfaction", value: c.would_recommend ? 1.0 : 0.0 })
  }

  if (c.compensation_accurate !== null) {
    const v = c.responses?.comp_accurate
    const value = v === "yes" || v === "increased" ? 1.0 : v === "close" ? 0.7 : 0.3
    signals.push({ type: "compensation_accuracy", value })
  }

  if (c.role_as_described !== null) {
    const v = c.responses?.role_match
    const value = v === "yes" ? 1.0 : v === "mostly" ? 0.6 : 0.1
    signals.push({ type: "role_accuracy", value })
  }

  if (c.culture_as_described !== null) {
    const v = c.responses?.culture
    const value = v === "yes" ? 1.0 : v === "mostly" ? 0.6 : 0.1
    signals.push({ type: "culture", value })
  }

  if (c.red_flags_found !== null) {
    signals.push({ type: "red_flag", value: c.red_flags_found ? 0.0 : 1.0 })
  }

  if (c.planning_to_leave !== null) {
    const v = c.responses?.stay_12mo ?? c.responses?.planning ?? c.responses?.stay_another
    const value = v === "yes" ? 1.0 : v === "unsure" ? 0.5 : 0.0
    signals.push({ type: "retention", value })
  }

  for (const sig of signals) {
    await pool.query(
      `INSERT INTO public.employer_experience_signals
         (company_id, signal_type, signal_value, source, weight, checkin_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [c.company_id, sig.type, sig.value, source, weight, checkinId]
    )
  }

  // Re-score company health score async
  const { computeHealthScore } = await import("@/lib/health/score-computer")
  computeHealthScore(c.company_id).catch(() => {})
}

export type InsiderViewStats = {
  avgSatisfaction: number | null
  recommendRate: number | null
  compensationAccuracyRate: number | null
  roleAccuracyRate: number | null
  cultureAccuracyRate: number | null
  redFlagRate: number | null
  checkinCount: number
  latestCheckinDate: string | null
}

export async function getInsiderViewStats(companyId: string): Promise<InsiderViewStats | null> {
  const pool = getPostgresPool()

  const countResult = await pool.query<{ cnt: string }>(
    `SELECT COUNT(DISTINCT checkin_id)::text AS cnt
     FROM public.employer_experience_signals WHERE company_id = $1`,
    [companyId]
  )
  const checkinCount = parseInt(countResult.rows[0]?.cnt ?? "0", 10)
  if (checkinCount < 5) return null

  const statsResult = await pool.query<{
    signal_type: string
    weighted_avg: string
    latest: string | null
  }>(
    `SELECT signal_type,
            SUM(signal_value * weight) / NULLIF(SUM(weight), 0) AS weighted_avg,
            MAX(created_at)::text AS latest
     FROM public.employer_experience_signals
     WHERE company_id = $1
     GROUP BY signal_type`,
    [companyId]
  )

  const byType: Record<string, number> = {}
  let latestCheckinDate: string | null = null

  for (const row of statsResult.rows) {
    byType[row.signal_type] = parseFloat(row.weighted_avg ?? "0")
    if (!latestCheckinDate || (row.latest && row.latest > latestCheckinDate)) {
      latestCheckinDate = row.latest
    }
  }

  const sat = byType["satisfaction"]
  const avgSatisfaction = sat !== undefined ? Math.round(sat * 5 * 10) / 10 : null

  return {
    avgSatisfaction,
    recommendRate: byType["satisfaction"] !== undefined
      ? Math.round(byType["satisfaction"] * 100)
      : null,
    compensationAccuracyRate: byType["compensation_accuracy"] !== undefined
      ? Math.round(byType["compensation_accuracy"] * 100)
      : null,
    roleAccuracyRate: byType["role_accuracy"] !== undefined
      ? Math.round(byType["role_accuracy"] * 100)
      : null,
    cultureAccuracyRate: byType["culture"] !== undefined
      ? Math.round(byType["culture"] * 100)
      : null,
    redFlagRate: byType["red_flag"] !== undefined
      ? Math.round((1 - byType["red_flag"]) * 100)
      : null,
    checkinCount,
    latestCheckinDate,
  }
}
