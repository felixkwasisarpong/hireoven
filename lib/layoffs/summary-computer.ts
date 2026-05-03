import { getPostgresPool } from "@/lib/postgres/server"

export type FreezeConfidence = "confirmed" | "likely" | "possible"
export type LayoffTrend = "accelerating" | "stable" | "recovering"

export type LayoffSummary = {
  companyId: string
  totalLayoffEvents: number
  totalEmployeesAffected: number | null
  mostRecentLayoffDate: string | null
  daysSinceLastLayoff: number | null
  hasActiveFreeeze: boolean
  freezeConfidence: FreezeConfidence | null
  layoffTrend: LayoffTrend
}

type EventRow = {
  event_date: string
  employees_affected: number | null
  source: string
  is_verified: boolean
}

export async function computeLayoffSummary(companyId: string): Promise<void> {
  const pool = getPostgresPool()

  const { rows } = await pool.query<EventRow>(
    `SELECT event_date::text, employees_affected, source, is_verified
     FROM layoff_events
     WHERE company_id = $1
     ORDER BY event_date DESC`,
    [companyId]
  )

  if (rows.length === 0) {
    await pool.query(
      `DELETE FROM company_layoff_summary WHERE company_id = $1`,
      [companyId]
    )
    return
  }

  const now = new Date()
  const daysSince = (dateStr: string) =>
    Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86_400_000)

  const totalEvents = rows.length
  const totalEmployees = rows.reduce((sum, r) => sum + (r.employees_affected ?? 0), 0) || null
  const mostRecentDate = rows[0].event_date
  const daysSinceRecent = daysSince(mostRecentDate)

  // Active freeze: any event within last 90 days
  const recentEvents = rows.filter(r => daysSince(r.event_date) <= 90)
  const hasActiveFreeeze = recentEvents.length > 0

  let freezeConfidence: FreezeConfidence | null = null
  if (hasActiveFreeeze) {
    const hasWarnAct = recentEvents.some(r => r.is_verified || r.source === "warn_act")
    const hasLargeLayoff = recentEvents.some(r => (r.employees_affected ?? 0) >= 100)
    if (hasWarnAct) freezeConfidence = "confirmed"
    else if (hasLargeLayoff) freezeConfidence = "likely"
    else freezeConfidence = "possible"
  }

  // Trend: compare events in last 6 months vs prior 6 months
  const in6mo = rows.filter(r => daysSince(r.event_date) <= 180).length
  const in6to12mo = rows.filter(r => {
    const d = daysSince(r.event_date)
    return d > 180 && d <= 365
  }).length

  let layoffTrend: LayoffTrend = "stable"
  if (hasActiveFreeeze) {
    if (in6mo > in6to12mo + 1) layoffTrend = "accelerating"
    else if (daysSinceRecent >= 91 && daysSinceRecent <= 180) layoffTrend = "recovering"
    else layoffTrend = "stable"
  } else if (daysSinceRecent >= 91 && daysSinceRecent <= 180) {
    layoffTrend = "recovering"
  }

  await pool.query(
    `INSERT INTO company_layoff_summary
       (company_id, total_layoff_events, total_employees_affected,
        most_recent_layoff_date, days_since_last_layoff,
        has_active_freeze, freeze_confidence, layoff_trend,
        last_computed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       total_layoff_events      = EXCLUDED.total_layoff_events,
       total_employees_affected = EXCLUDED.total_employees_affected,
       most_recent_layoff_date  = EXCLUDED.most_recent_layoff_date,
       days_since_last_layoff   = EXCLUDED.days_since_last_layoff,
       has_active_freeze        = EXCLUDED.has_active_freeze,
       freeze_confidence        = EXCLUDED.freeze_confidence,
       layoff_trend             = EXCLUDED.layoff_trend,
       last_computed_at         = NOW(),
       updated_at               = NOW()`,
    [
      companyId,
      totalEvents,
      totalEmployees,
      mostRecentDate,
      daysSinceRecent,
      hasActiveFreeeze,
      freezeConfidence,
      layoffTrend,
    ]
  )

  // Mirror active freezes into company_news_signals for backward compatibility
  if (hasActiveFreeeze) {
    pool.query(
      `INSERT INTO company_news_signals (company_id, signal_type, headline, detected_at)
       VALUES ($1, 'hiring_freeze', $2, NOW())
       ON CONFLICT DO NOTHING`,
      [
        companyId,
        freezeConfidence === "confirmed"
          ? "WARN Act notice filed — confirmed layoff event"
          : "Layoff reported via layoffs.fyi",
      ]
    ).catch(() => {})
  }
}

export async function computeAllSummaries(companyIds: string[]): Promise<{ computed: number; failed: number }> {
  let computed = 0
  let failed = 0
  for (const id of companyIds) {
    try {
      await computeLayoffSummary(id)
      computed++
    } catch { failed++ }
  }
  return { computed, failed }
}
