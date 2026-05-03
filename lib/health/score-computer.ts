import { getPostgresPool } from "@/lib/postgres/server"
import { importFundingData } from "./importers/funding-importer"
import { importGlassdoorData } from "./importers/glassdoor-importer"
import { importLinkedinHeadcount } from "./importers/linkedin-importer"
import type { CompanyHealthScore, HealthSignal, HealthEvent, HealthVerdict } from "@/types"

// ── Verdict ───────────────────────────────────────────────────────────────────

function computeVerdict(score: number): HealthVerdict {
  if (score >= 75) return "strong"
  if (score >= 55) return "healthy"
  if (score >= 35) return "caution"
  return "critical"
}

// ── Funding score (0–25) ──────────────────────────────────────────────────────

type FundingScoreResult = {
  score: number
  stage: string | null
  amountUsd: number | null
  fundingDate: string | null
  monthsSince: number | null
  signal: HealthSignal
}

async function computeFundingScore(companyId: string, companyName: string): Promise<FundingScoreResult> {
  const pool = getPostgresPool()

  // Check cached funding first
  const cached = await pool.query<{
    round_type: string
    amount_usd: string | null
    announced_date: string
  }>(
    `SELECT round_type, amount_usd, announced_date::text
     FROM company_funding_data
     WHERE company_id = $1
     ORDER BY announced_date DESC
     LIMIT 1`,
    [companyId]
  ).catch(() => ({ rows: [] as { round_type: string; amount_usd: string | null; announced_date: string }[] }))

  let stage: string | null = null
  let amountUsd: number | null = null
  let fundingDate: string | null = null
  let monthsSince: number | null = null

  if (cached.rows[0]) {
    stage = cached.rows[0].round_type
    amountUsd = cached.rows[0].amount_usd ? Number(cached.rows[0].amount_usd) : null
    fundingDate = cached.rows[0].announced_date
    monthsSince = Math.floor((Date.now() - new Date(fundingDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
  } else {
    // Try to import fresh
    const imported = await importFundingData(companyId, companyName)
    if (imported) {
      stage = imported.roundType
      amountUsd = imported.amountUsd
      fundingDate = imported.announcedDate
      monthsSince = imported.monthsSince
    }
  }

  let score = 3 // no data default
  if (monthsSince !== null) {
    if (monthsSince <= 12) score = 25
    else if (monthsSince <= 18) score = 20
    else if (monthsSince <= 24) score = 15
    else if (monthsSince <= 36) score = 8
    else score = 3
  }

  // Stage bonus: late-stage = established
  const lateStages = ["series_d", "series_e", "series_f", "growth", "ipo", "public", "crossover"]
  if (stage && lateStages.includes(stage.toLowerCase().replace(/\s+/g, "_"))) {
    score = Math.min(25, score + 3)
  }

  const noData = monthsSince === null
  const detail = noData
    ? "No public funding data found."
    : `Last known funding: ${stage ? stage.replace(/_/g, " ").toUpperCase() : "Unknown round"}${amountUsd ? ` · $${(amountUsd / 1_000_000).toFixed(0)}M` : ""} · ${monthsSince} months ago`

  return {
    score,
    stage,
    amountUsd,
    fundingDate,
    monthsSince,
    signal: {
      icon: "attach_money",
      title: noData ? "Funding data unavailable" : `Funded ${monthsSince}mo ago`,
      detail,
      weight: score - 12,
      severity: score >= 20 ? "positive" : score >= 12 ? "neutral" : "warning",
      expandDetail: noData
        ? "We couldn't find public funding data for this company. Check Crunchbase or LinkedIn for the latest."
        : `Score: ${score}/25. ${score >= 20 ? "Recent funding is a strong stability signal." : score >= 12 ? "Funding is ageing — watch for signs of the next round or profitability." : "This company hasn't raised in over 2 years. Runway may be a concern."}`,
    },
  }
}

// ── Layoff score (0–25) ───────────────────────────────────────────────────────

type LayoffScoreResult = {
  score: number
  roundsIn12mo: number
  daysSinceLastLayoff: number | null
  signals: HealthSignal[]
  events: HealthEvent[]
}

async function computeLayoffScore(companyId: string): Promise<LayoffScoreResult> {
  const pool = getPostgresPool()

  const [summaryRes, eventsIn12moRes, recentEventsRes] = await Promise.all([
    pool.query<{
      days_since_last_layoff: number | null
      total_employees_affected: number | null
      freeze_confidence: string | null
    }>(
      `SELECT days_since_last_layoff, total_employees_affected, freeze_confidence
       FROM company_layoff_summary WHERE company_id = $1 LIMIT 1`,
      [companyId]
    ).catch(() => ({ rows: [] as { days_since_last_layoff: number | null; total_employees_affected: number | null; freeze_confidence: string | null }[] })),

    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM layoff_events
       WHERE company_id = $1 AND event_date > NOW() - INTERVAL '12 months'`,
      [companyId]
    ).catch(() => ({ rows: [{ count: "0" }] })),

    pool.query<{ event_date: string; employees_affected: number | null; headline: string | null; source: string }>(
      `SELECT event_date::text, employees_affected, headline, source
       FROM layoff_events WHERE company_id = $1
       ORDER BY event_date DESC LIMIT 5`,
      [companyId]
    ).catch(() => ({ rows: [] as { event_date: string; employees_affected: number | null; headline: string | null; source: string }[] })),
  ])

  const summary = summaryRes.rows[0] ?? null
  const roundsIn12mo = Number(eventsIn12moRes.rows[0]?.count ?? 0)
  const days = summary?.days_since_last_layoff ?? null

  let score = 25
  if (days === null) {
    score = 25 // no layoffs = great
  } else if (days >= 180 && roundsIn12mo <= 1) {
    score = 20
  } else if (days >= 90) {
    score = 15
  } else if (roundsIn12mo <= 1) {
    score = 8
  } else if (roundsIn12mo === 2) {
    score = 3
  } else {
    score = 0 // 3+ rounds
  }

  const noLayoffs = days === null
  const signals: HealthSignal[] = [{
    icon: noLayoffs ? "check_circle" : roundsIn12mo >= 3 ? "group_remove" : days !== null && days < 90 ? "warning" : "schedule",
    title: noLayoffs
      ? "No layoff history found"
      : roundsIn12mo >= 3
      ? `${roundsIn12mo} layoff rounds in the last year`
      : `Last layoff: ${days} days ago`,
    detail: noLayoffs
      ? "No verified layoff events in WARN Act or layoffs.fyi data."
      : `${summary?.total_employees_affected?.toLocaleString() ?? "Unknown"} total employees affected across ${roundsIn12mo} round${roundsIn12mo !== 1 ? "s" : ""} in the last year.`,
    weight: score - 12,
    severity: score >= 20 ? "positive" : score >= 12 ? "neutral" : score >= 8 ? "warning" : "negative",
    expandDetail: noLayoffs
      ? "Absence of layoff events is a positive signal, but doesn't rule out future reductions. Cross-reference with hiring velocity."
      : `Layoff score: ${score}/25. ${roundsIn12mo >= 2 ? "Multiple rounds in a single year is a significant red flag." : days !== null && days < 90 ? "A very recent layoff suggests the company may still be restructuring." : "The most recent layoff was over 6 months ago — signs of stabilisation."}`,
  }]

  const events: HealthEvent[] = recentEventsRes.rows.map(ev => ({
    icon: "group_remove",
    title: ev.headline ?? "Layoff event",
    detail: ev.employees_affected
      ? `${ev.employees_affected.toLocaleString()} employees affected · ${ev.source === "warn_act" ? "WARN Act verified" : "layoffs.fyi"}`
      : `Source: ${ev.source === "warn_act" ? "WARN Act (verified)" : "layoffs.fyi"}`,
    date: ev.event_date,
    type: "layoff" as const,
  }))

  return { score: Math.max(0, score), roundsIn12mo, daysSinceLastLayoff: days, signals, events }
}

// ── Glassdoor score (0–25) ────────────────────────────────────────────────────

type GlassdoorScoreResult = {
  score: number
  rating: number | null
  rating12moAgo: number | null
  trend: "improving" | "stable" | "declining"
  signal: HealthSignal
}

async function computeGlassdoorScore(companyId: string, companyName: string): Promise<GlassdoorScoreResult> {
  const pool = getPostgresPool()

  // Check cached score for prior rating
  const cached = await pool.query<{ glassdoor_rating: string | null; glassdoor_rating_12mo_ago: string | null }>(
    `SELECT glassdoor_rating, glassdoor_rating_12mo_ago FROM company_health_scores WHERE company_id = $1 LIMIT 1`,
    [companyId]
  ).catch(() => ({ rows: [] as { glassdoor_rating: string | null; glassdoor_rating_12mo_ago: string | null }[] }))

  const priorRating = cached.rows[0]?.glassdoor_rating ? Number(cached.rows[0].glassdoor_rating) : null

  // Try fresh Glassdoor data
  const gd = await importGlassdoorData(companyId, companyName)
  const rating = gd.rating ?? priorRating

  let score = 12 // neutral if no data
  if (rating !== null) {
    if (rating >= 4.5) score = 25
    else if (rating >= 4.0) score = 20
    else if (rating >= 3.5) score = 14
    else if (rating >= 3.0) score = 8
    else score = 2
  }

  // Trend adjustment
  let trend: GlassdoorScoreResult["trend"] = "stable"
  const oldRating = cached.rows[0]?.glassdoor_rating_12mo_ago
    ? Number(cached.rows[0].glassdoor_rating_12mo_ago) : null

  if (rating !== null && oldRating !== null) {
    const delta = rating - oldRating
    if (delta >= 0.3) { trend = "improving"; score = Math.min(25, score + 4) }
    else if (delta <= -0.3) { trend = "declining"; score = Math.max(0, score - 6) }
  }

  const noData = rating === null
  return {
    score,
    rating,
    rating12moAgo: oldRating,
    trend,
    signal: {
      icon: noData ? "rate_review" : rating >= 4.0 ? "star" : rating >= 3.5 ? "star_half" : "star_border",
      title: noData ? "Glassdoor data unavailable" : `Glassdoor: ${rating.toFixed(1)}/5`,
      detail: noData
        ? "Could not retrieve Glassdoor rating — data may be blocked or unavailable."
        : `${rating.toFixed(1)}/5 overall rating${trend !== "stable" ? ` · trend: ${trend}` : ""}`,
      weight: score - 12,
      severity: score >= 20 ? "positive" : score >= 12 ? "neutral" : "warning",
      expandDetail: noData ? null : `Score: ${score}/25. ${score >= 20 ? "Strong employee sentiment." : score >= 12 ? "Mixed employee sentiment." : "Negative employee sentiment — investigate before committing."}`,
    },
  }
}

// ── Headcount score (0–25) ────────────────────────────────────────────────────

type HeadcountScoreResult = {
  score: number
  current: number | null
  changePct: number | null
  trend: "growing" | "stable" | "shrinking" | "contracting"
  signal: HealthSignal
}

async function computeHeadcountScore(companyId: string): Promise<HeadcountScoreResult> {
  const hc = await importLinkedinHeadcount(companyId)

  let score = 12
  if (hc.changePct !== null) {
    const pct = hc.changePct
    if (pct >= 10) score = 25
    else if (pct >= 1) score = 20
    else if (pct >= -1) score = 15
    else if (pct >= -10) score = 8
    else if (pct >= -20) score = 4
    else score = 0
  }

  const noData = hc.changePct === null
  const trendLabel = { growing: "Growing", stable: "Stable", shrinking: "Shrinking", contracting: "Contracting" }[hc.trend]

  return {
    score,
    current: hc.currentEstimate,
    changePct: hc.changePct,
    trend: hc.trend,
    signal: {
      icon: hc.trend === "growing" ? "trending_up" : hc.trend === "contracting" ? "trending_down" : "corporate_fare",
      title: noData ? "Headcount data unavailable" : `Headcount: ${trendLabel}${hc.changePct !== null ? ` ${hc.changePct > 0 ? "+" : ""}${hc.changePct.toFixed(0)}%` : ""}`,
      detail: noData
        ? `Job posting velocity used as proxy (source: ${hc.source}).`
        : `${hc.changePct !== null && hc.changePct > 0 ? "+" : ""}${hc.changePct?.toFixed(0) ?? "?"}% change in posting activity (90-day window). Source: ${hc.source}.`,
      weight: score - 12,
      severity: score >= 20 ? "positive" : score >= 12 ? "neutral" : score >= 8 ? "warning" : "negative",
      expandDetail: noData ? null : `Score: ${score}/25. Based on job posting velocity which serves as a headcount proxy when LinkedIn data is unavailable.`,
    },
  }
}

// ── Events from funding data ───────────────────────────────────────────────────

async function fetchFundingEvents(companyId: string): Promise<HealthEvent[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    round_type: string
    amount_usd: string | null
    announced_date: string
    lead_investor: string | null
  }>(
    `SELECT round_type, amount_usd, announced_date::text, lead_investor
     FROM company_funding_data WHERE company_id = $1 ORDER BY announced_date DESC LIMIT 5`,
    [companyId]
  ).catch(() => ({ rows: [] as { round_type: string; amount_usd: string | null; announced_date: string; lead_investor: string | null }[] }))

  return rows.map(r => ({
    icon: "attach_money",
    title: `${r.round_type.replace(/_/g, " ").toUpperCase()} funding round`,
    detail: [
      r.amount_usd ? `$${(Number(r.amount_usd) / 1_000_000).toFixed(0)}M raised` : null,
      r.lead_investor ? `Lead: ${r.lead_investor}` : null,
    ].filter(Boolean).join(" · ") || "Funding amount undisclosed",
    date: r.announced_date,
    type: "funding" as const,
  }))
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function computeHealthScore(companyId: string): Promise<CompanyHealthScore> {
  const pool = getPostgresPool()

  const companyRes = await pool.query<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1 LIMIT 1`,
    [companyId]
  )
  const companyName = companyRes.rows[0]?.name ?? "Unknown"

  // Run all sub-scores in parallel
  const [funding, layoff, glassdoor, headcount] = await Promise.all([
    computeFundingScore(companyId, companyName),
    computeLayoffScore(companyId),
    computeGlassdoorScore(companyId, companyName),
    computeHeadcountScore(companyId),
  ])

  const fundingEvents = await fetchFundingEvents(companyId)
  const total = funding.score + layoff.score + glassdoor.score + headcount.score
  const verdict = computeVerdict(total)

  // Build signals sorted by absolute weight descending
  const allSignals: HealthSignal[] = [
    funding.signal,
    ...layoff.signals,
    glassdoor.signal,
    headcount.signal,
  ].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))

  // Build events merged + sorted
  const allEvents: HealthEvent[] = [
    ...layoff.events,
    ...fundingEvents,
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const now = new Date().toISOString()

  // Persist
  await pool.query(
    `INSERT INTO company_health_scores
       (company_id, total_score, verdict, funding_score, layoff_score, glassdoor_score, headcount_score,
        funding_stage, funding_amount_usd, funding_date, months_since_funding,
        glassdoor_rating, glassdoor_rating_12mo_ago, glassdoor_trend,
        headcount_current, headcount_change_12mo_pct, headcount_trend,
        signals, events, last_computed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,NOW(),NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       total_score=$2, verdict=$3, funding_score=$4, layoff_score=$5, glassdoor_score=$6, headcount_score=$7,
       funding_stage=$8, funding_amount_usd=$9, funding_date=$10, months_since_funding=$11,
       glassdoor_rating=$12, glassdoor_rating_12mo_ago=$13, glassdoor_trend=$14,
       headcount_current=$15, headcount_change_12mo_pct=$16, headcount_trend=$17,
       signals=$18::jsonb, events=$19::jsonb, last_computed_at=NOW(), updated_at=NOW()`,
    [
      companyId, total, verdict, funding.score, layoff.score, glassdoor.score, headcount.score,
      funding.stage, funding.amountUsd, funding.fundingDate, funding.monthsSince,
      glassdoor.rating, glassdoor.rating12moAgo, glassdoor.trend,
      headcount.current, headcount.changePct, headcount.trend,
      JSON.stringify(allSignals), JSON.stringify(allEvents),
    ]
  )

  return {
    companyId,
    totalScore: total,
    verdict,
    fundingScore: funding.score,
    layoffScore: layoff.score,
    glassdoorScore: glassdoor.score,
    headcountScore: headcount.score,
    fundingStage: funding.stage,
    fundingAmountUsd: funding.amountUsd,
    fundingDate: funding.fundingDate,
    monthsSinceFunding: funding.monthsSince,
    glassdoorRating: glassdoor.rating,
    glassdoorRating12moAgo: glassdoor.rating12moAgo,
    glassdoorTrend: glassdoor.trend,
    headcountCurrent: headcount.current,
    headcountChange12moPct: headcount.changePct,
    headcountTrend: headcount.trend,
    csuiteDepatures12mo: 0,
    signals: allSignals,
    events: allEvents,
    lastComputedAt: now,
  }
}

// ── Bulk recompute ─────────────────────────────────────────────────────────────

export async function computeHealthScoreForAll(): Promise<{ computed: number; failed: number; durationMs: number }> {
  const pool = getPostgresPool()
  const started = Date.now()

  const { rows } = await pool.query<{ id: string }>(
    `SELECT c.id
     FROM companies c
     WHERE NOT EXISTS (
       SELECT 1 FROM company_health_scores chs
       WHERE chs.company_id = c.id
         AND chs.last_computed_at > NOW() - INTERVAL '48 hours'
     )
     LIMIT 200`
  )

  let computed = 0
  let failed = 0
  const BATCH = 20

  for (let i = 0; i < rows.length; i += BATCH) {
    await Promise.all(
      rows.slice(i, i + BATCH).map(async ({ id }) => {
        try { await computeHealthScore(id); computed++ }
        catch { failed++ }
      })
    )
  }

  return { computed, failed, durationMs: Date.now() - started }
}
