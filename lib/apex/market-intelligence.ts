/**
 * Scout Market Intelligence — V1
 *
 * Computes lightweight aggregate market signals from the user's job search
 * activity and the broader jobs/company dataset.
 *
 * All signals are:
 *   - evidence-backed (derived from real DB counts, never invented)
 *   - phrased cautiously ("may be stale", "appears to", "based on N postings")
 *   - confidence-weighted (0–1, reflecting data quality/sample size)
 *
 * Safety rules:
 *   - No fake probabilities
 *   - No fabricated market claims
 *   - No deterministic hiring guarantees
 *   - Phrased with appropriate uncertainty
 */

import { getPostgresPool } from "@/lib/postgres/server"

// ── Types ─────────────────────────────────────────────────────────────────────

export type MarketSignalType =
  | "salary_shift"
  | "sponsorship_trend"
  | "ghost_job_risk"
  | "hiring_spike"
  | "market_cooling"
  | "skill_demand"
  | "response_likelihood"
  | "application_competition"

export type MarketSignal = {
  id: string
  type: MarketSignalType
  title: string
  /** One-sentence summary, phrased cautiously with evidence basis */
  summary: string
  /** 0–1 reflecting data quality and sample size */
  confidence: number
  severity: "info" | "positive" | "warning"
  relatedRoles?: string[]
  relatedSkills?: string[]
  relatedCompanies?: string[]
  createdAt: string
}

// ── DB row types (internal) ───────────────────────────────────────────────────

type WatchlistStatsRow = {
  total_companies: number
  sponsor_count: number
  fresh_jobs: number
  stale_jobs: number
  total_active_jobs: number
  avg_salary_min: number | null
  avg_salary_max: number | null
  salary_count: number
}

type ApplicationOutcomeRow = {
  total: number
  positive_count: number
  remote_positive: number
  remote_total: number
}

type TopSkillsRow = {
  skill: string
  count: number
}

type GhostJobRow = {
  job_id: string
  title: string
  company_name: string
  days_old: number
}

// ── Signal generators ─────────────────────────────────────────────────────────

function clampConf(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100))
}

function signalFromWatchlistStats(
  stats: WatchlistStatsRow,
  salaryExpMin: number | null,
): MarketSignal[] {
  const signals: MarketSignal[] = []
  const now = new Date().toISOString()
  const totalCo = stats.total_companies

  if (totalCo < 1) return signals

  // ── Sponsorship density ─────────────────────────────────────────────────────
  const sponsorRate = stats.sponsor_count / totalCo
  if (sponsorRate >= 0.6) {
    signals.push({
      id: "sponsorship-density-high",
      type: "sponsorship_trend",
      title: "Strong sponsorship coverage in your targets",
      summary: `${Math.round(sponsorRate * 100)}% of your target companies show H-1B sponsorship signals — a favorable pool.`,
      confidence: clampConf(totalCo >= 5 ? 0.78 : 0.55),
      severity: "positive",
      createdAt: now,
    })
  } else if (sponsorRate < 0.35 && totalCo >= 3) {
    signals.push({
      id: "sponsorship-density-low",
      type: "sponsorship_trend",
      title: "Low sponsorship signals in saved targets",
      summary: `Only ${Math.round(sponsorRate * 100)}% of your target companies show H-1B signals. Consider adding sponsorship filter.`,
      confidence: clampConf(totalCo >= 5 ? 0.72 : 0.5),
      severity: "warning",
      createdAt: now,
    })
  }

  // ── Fresh postings spike ────────────────────────────────────────────────────
  const freshRate = stats.total_active_jobs > 0
    ? stats.fresh_jobs / stats.total_active_jobs
    : 0
  if (stats.fresh_jobs >= 3 && freshRate >= 0.25) {
    signals.push({
      id: "fresh-postings-spike",
      type: "hiring_spike",
      title: "Hiring activity at your target companies",
      summary: `${stats.fresh_jobs} new posting${stats.fresh_jobs !== 1 ? "s" : ""} from your target companies appeared in the last 7 days.`,
      confidence: clampConf(0.85),
      severity: "positive",
      relatedCompanies: [],
      createdAt: now,
    })
  }

  // ── Stale job warning ───────────────────────────────────────────────────────
  const staleRate = stats.total_active_jobs > 0
    ? stats.stale_jobs / stats.total_active_jobs
    : 0
  if (staleRate >= 0.4 && stats.stale_jobs >= 2) {
    signals.push({
      id: "stale-jobs-warning",
      type: "ghost_job_risk",
      title: "Some target roles may be stale",
      summary: `${stats.stale_jobs} of your target roles have been posted for over 45 days — they may have filled or been abandoned.`,
      confidence: clampConf(0.68),
      severity: "warning",
      createdAt: now,
    })
  }

  // ── Salary alignment ────────────────────────────────────────────────────────
  if (
    salaryExpMin != null &&
    stats.avg_salary_max != null &&
    stats.salary_count >= 3
  ) {
    const marketMax = stats.avg_salary_max
    const pct = Math.round((salaryExpMin / marketMax) * 100)
    if (pct > 110) {
      signals.push({
        id: "salary-above-market",
        type: "salary_shift",
        title: "Salary expectations may exceed postings",
        summary: `Your expected minimum ($${(salaryExpMin / 1000).toFixed(0)}K) appears above the average posted max ($${(marketMax / 1000).toFixed(0)}K) in your target roles. Verify alignment.`,
        confidence: clampConf(stats.salary_count >= 5 ? 0.65 : 0.45),
        severity: "warning",
        createdAt: now,
      })
    } else if (pct < 75) {
      signals.push({
        id: "salary-below-market",
        type: "salary_shift",
        title: "Salary expectations below posted ranges",
        summary: `Your target salary ($${(salaryExpMin / 1000).toFixed(0)}K min) is below the average max posted ($${(marketMax / 1000).toFixed(0)}K) — you may have room to negotiate higher.`,
        confidence: clampConf(stats.salary_count >= 5 ? 0.62 : 0.4),
        severity: "info",
        createdAt: now,
      })
    }
  }

  return signals
}

function signalFromApplicationOutcomes(row: ApplicationOutcomeRow): MarketSignal[] {
  const signals: MarketSignal[] = []
  const now = new Date().toISOString()

  if (row.total < 5) return signals

  const responseRate = row.positive_count / row.total
  if (responseRate >= 0.25) {
    signals.push({
      id: "response-rate-positive",
      type: "response_likelihood",
      title: "Solid application-to-interview rate",
      summary: `${Math.round(responseRate * 100)}% of your applications progressed past initial screening — above typical conversion rates.`,
      confidence: clampConf(row.total >= 10 ? 0.72 : 0.55),
      severity: "positive",
      createdAt: now,
    })
  } else if (responseRate < 0.08 && row.total >= 8) {
    signals.push({
      id: "response-rate-low",
      type: "response_likelihood",
      title: "Application conversion appears low",
      summary: `Based on your last ${row.total} applications, response rate is ${Math.round(responseRate * 100)}%. Tighter targeting or resume tailoring may help.`,
      confidence: clampConf(row.total >= 12 ? 0.68 : 0.5),
      severity: "warning",
      createdAt: now,
    })
  }

  return signals
}

// ── Main export ───────────────────────────────────────────────────────────────

export type MarketIntelligenceResult = {
  signals: MarketSignal[]
  /** ISO timestamp for cache freshness display */
  computedAt: string
}

/**
 * Computes lightweight market intelligence signals for a user.
 * Queries are fast aggregates over indexed columns — no heavy text scanning.
 * Returns at most 4 signals, ordered by severity (warning > positive > info).
 */
export async function getMarketIntelligence(
  userId: string,
  salaryExpMin?: number | null,
): Promise<MarketIntelligenceResult> {
  const pool = getPostgresPool()
  const computedAt = new Date().toISOString()

  try {
    const [watchlistStats, appOutcomes] = await Promise.all([
      pool.query<WatchlistStatsRow>(
        `SELECT
           COUNT(DISTINCT w.company_id)::int AS total_companies,
           COUNT(DISTINCT w.company_id) FILTER (
             WHERE c.sponsors_h1b = true OR c.sponsorship_confidence >= 65
           )::int AS sponsor_count,
           COUNT(j.id) FILTER (
             WHERE j.is_active = true
               AND j.first_detected_at >= NOW() - INTERVAL '7 days'
           )::int AS fresh_jobs,
           COUNT(j.id) FILTER (
             WHERE j.is_active = true
               AND j.first_detected_at < NOW() - INTERVAL '45 days'
           )::int AS stale_jobs,
           COUNT(j.id) FILTER (WHERE j.is_active = true)::int AS total_active_jobs,
           AVG(j.salary_min) AS avg_salary_min,
           AVG(j.salary_max) AS avg_salary_max,
           COUNT(j.id) FILTER (
             WHERE j.is_active = true
               AND (j.salary_min IS NOT NULL OR j.salary_max IS NOT NULL)
           )::int AS salary_count
         FROM watchlist w
         JOIN companies c ON c.id = w.company_id
         LEFT JOIN jobs j ON j.company_id = c.id
         WHERE w.user_id = $1`,
        [userId],
      ),

      pool.query<ApplicationOutcomeRow>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (
             WHERE ja.status IN ('phone_screen', 'interview', 'final_round', 'offer')
           )::int AS positive_count,
           COUNT(*) FILTER (
             WHERE j.is_remote = true
               AND ja.status IN ('phone_screen', 'interview', 'final_round', 'offer')
           )::int AS remote_positive,
           COUNT(*) FILTER (WHERE j.is_remote = true)::int AS remote_total
         FROM job_applications ja
         JOIN jobs j ON j.id = ja.job_id
         WHERE ja.user_id = $1
           AND ja.is_archived = false
           AND COALESCE(ja.applied_at, ja.created_at) >= NOW() - INTERVAL '90 days'`,
        [userId],
      ),
    ])

    const stats = watchlistStats.rows[0]
    const outcomes = appOutcomes.rows[0]

    const all: MarketSignal[] = [
      ...(stats ? signalFromWatchlistStats(stats, salaryExpMin ?? null) : []),
      ...(outcomes ? signalFromApplicationOutcomes(outcomes) : []),
    ]

    // Sort: warning first, then positive, then info
    const priority: Record<string, number> = { warning: 0, positive: 1, info: 2 }
    all.sort((a, b) => (priority[a.severity] ?? 2) - (priority[b.severity] ?? 2))

    return { signals: all.slice(0, 4), computedAt }
  } catch {
    // Fail silently — market intelligence is supplemental, not critical
    return { signals: [], computedAt }
  }
}

/**
 * Formats market signals as a compact string for Claude context injection.
 * Only injects when there are actionable signals with evidence.
 */
export function formatMarketSignalsForClaude(signals: MarketSignal[]): string {
  if (signals.length === 0) return ""

  const lines = signals.map((s) => {
    const conf = Math.round(s.confidence * 100)
    return `- [${s.severity.toUpperCase()} · ${conf}% confidence] ${s.title}: ${s.summary}`
  })

  return `Market Signals (evidence-based — acknowledge uncertainty when referencing these):\n${lines.join("\n")}`
}
