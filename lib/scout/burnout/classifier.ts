import { getPostgresPool } from "@/lib/postgres/server"
import { computeMismatchScore } from "./mismatch-detector"

// ── Types ─────────────────────────────────────────────────────────────────────

export type BurnoutSignal = {
  signal: string
  value: string | number
  severity: "low" | "medium" | "high"
}

export type BurnoutState = {
  state: "healthy" | "slowing" | "stalled" | "burnt_out" | "anxious"
  confidence: "high" | "medium" | "low"
  signals: BurnoutSignal[]
  daysSinceLastApplication: number
  daysSinceLastLogin: number
  applicationVelocityTrend: "increasing" | "stable" | "decreasing" | "stopped"
  sessionQualityTrend: "engaged" | "browsing" | "passive" | "absent"
  mismatchScore: number
  recommendation: string
  interventionType: "none" | "gentle_nudge" | "reframe" | "rest_suggestion" | "strategy_reset" | "emergency_reengagement"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 999
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

// ── Main classifier ───────────────────────────────────────────────────────────

export async function classifyBurnoutState(userId: string): Promise<BurnoutState> {
  const pool = getPostgresPool()

  const [appResult, sessionResult, savedResult, rejectionResult] = await Promise.all([
    // Application history for velocity + timing
    pool.query<{
      applied_at: string | null
      created_at: string
      status: string
      match_score: number | null
    }>(
      `SELECT applied_at, created_at, status, match_score
       FROM job_applications
       WHERE user_id = $1 AND is_archived = false
       ORDER BY COALESCE(applied_at, created_at) DESC
       LIMIT 60`,
      [userId]
    ),
    // Session quality trend
    pool.query<{
      session_at: string
      session_quality: string
      duration_seconds: number
      actions_count: number
      mode_changes: number
    }>(
      `SELECT session_at, session_quality, duration_seconds, actions_count, mode_changes
       FROM public.user_session_quality
       WHERE user_id = $1
       ORDER BY session_at DESC
       LIMIT 30`,
      [userId]
    ),
    // Saved vs applied ratio
    pool.query<{ saved_count: string; applied_count: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'saved')::text AS saved_count,
         COUNT(*) FILTER (WHERE status != 'saved')::text AS applied_count
       FROM job_applications
       WHERE user_id = $1 AND is_archived = false
         AND created_at >= NOW() - INTERVAL '14 days'`,
      [userId]
    ),
    // Recent rejection rate vs historical
    pool.query<{ recent_rejections: string; recent_total: string; hist_rejections: string; hist_total: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'rejected' AND created_at >= NOW() - INTERVAL '14 days')::text AS recent_rejections,
         COUNT(*) FILTER (WHERE status != 'saved' AND created_at >= NOW() - INTERVAL '14 days')::text AS recent_total,
         COUNT(*) FILTER (WHERE status = 'rejected' AND created_at < NOW() - INTERVAL '14 days')::text AS hist_rejections,
         COUNT(*) FILTER (WHERE status != 'saved' AND created_at < NOW() - INTERVAL '14 days')::text AS hist_total
       FROM job_applications WHERE user_id = $1 AND is_archived = false`,
      [userId]
    ),
  ])

  const apps = appResult.rows
  const sessions = sessionResult.rows
  const savedRatio = savedResult.rows[0]
  const rejRow = rejectionResult.rows[0]

  // ── Days since last application ──────────────────────────────────────────
  const lastAppDate = apps.find((a) => a.status !== "saved")?.applied_at
    ?? apps.find((a) => a.status !== "saved")?.created_at
    ?? null
  const daysSinceLastApplication = daysSince(lastAppDate)

  // ── Days since last login (proxy: last session or last application activity) ──
  const lastSession = sessions[0]?.session_at ?? lastAppDate
  const daysSinceLastLogin = daysSince(lastSession)

  // ── Application velocity trend ───────────────────────────────────────────
  const last14 = apps.filter((a) => {
    const d = daysSince(a.applied_at ?? a.created_at)
    return d <= 14 && a.status !== "saved"
  }).length
  const prev14 = apps.filter((a) => {
    const d = daysSince(a.applied_at ?? a.created_at)
    return d > 14 && d <= 28 && a.status !== "saved"
  }).length

  let applicationVelocityTrend: BurnoutState["applicationVelocityTrend"] = "stable"
  if (last14 === 0 && prev14 === 0) applicationVelocityTrend = "stopped"
  else if (last14 === 0) applicationVelocityTrend = "stopped"
  else if (last14 > prev14 * 1.3) applicationVelocityTrend = "increasing"
  else if (last14 < prev14 * 0.6) applicationVelocityTrend = "decreasing"

  // ── Session quality trend ────────────────────────────────────────────────
  const last7Sessions = sessions.filter((s) => daysSince(s.session_at) <= 7)
  const prev7Sessions = sessions.filter((s) => {
    const d = daysSince(s.session_at)
    return d > 7 && d <= 14
  })

  let sessionQualityTrend: BurnoutState["sessionQualityTrend"] = "absent"
  if (last7Sessions.length === 0) {
    sessionQualityTrend = "absent"
  } else {
    const qualityScore = (q: string) =>
      q === "deep" ? 4 : q === "moderate" ? 3 : q === "passive" ? 2 : 1
    const avgRecent =
      last7Sessions.reduce((s, x) => s + qualityScore(x.session_quality), 0) /
      last7Sessions.length
    sessionQualityTrend =
      avgRecent >= 3.5 ? "engaged" : avgRecent >= 2.5 ? "browsing" : avgRecent >= 1.5 ? "passive" : "absent"
  }

  // ── Mismatch score ───────────────────────────────────────────────────────
  let mismatchScore = 0
  try {
    mismatchScore = await computeMismatchScore(userId)
  } catch {
    // non-blocking
  }

  // ── Rapid mode switches (anxiety signal) ─────────────────────────────────
  const avgModeChanges =
    last7Sessions.length > 0
      ? last7Sessions.reduce((s, x) => s + x.mode_changes, 0) / last7Sessions.length
      : 0

  // ── Saved-to-applied ratio ────────────────────────────────────────────────
  const savedCount = parseInt(savedRatio?.saved_count ?? "0", 10)
  const appliedCount = parseInt(savedRatio?.applied_count ?? "0", 10)
  const highSaveToApplyRatio = savedCount > 3 && appliedCount === 0

  // ── Rejection rate spike ──────────────────────────────────────────────────
  const recentRejPct = parseInt(rejRow?.recent_total ?? "0", 10) > 0
    ? parseInt(rejRow.recent_rejections, 10) / parseInt(rejRow.recent_total, 10)
    : 0
  const histRejPct = parseInt(rejRow?.hist_total ?? "0", 10) > 0
    ? parseInt(rejRow.hist_rejections, 10) / parseInt(rejRow.hist_total, 10)
    : 0
  const rejectionSpike = recentRejPct > histRejPct * 1.5 && recentRejPct > 0.4

  // ── Build signals ─────────────────────────────────────────────────────────
  const signals: BurnoutSignal[] = []

  if (daysSinceLastApplication > 21)
    signals.push({ signal: "days_since_application", value: daysSinceLastApplication, severity: "high" })
  else if (daysSinceLastApplication > 14)
    signals.push({ signal: "days_since_application", value: daysSinceLastApplication, severity: "medium" })
  else if (daysSinceLastApplication > 7)
    signals.push({ signal: "days_since_application", value: daysSinceLastApplication, severity: "low" })

  if (applicationVelocityTrend === "stopped")
    signals.push({ signal: "velocity_trend", value: "stopped", severity: "high" })
  else if (applicationVelocityTrend === "decreasing")
    signals.push({ signal: "velocity_trend", value: "decreasing", severity: "medium" })

  if (sessionQualityTrend === "absent")
    signals.push({ signal: "session_quality", value: "absent", severity: "high" })
  else if (sessionQualityTrend === "passive")
    signals.push({ signal: "session_quality", value: "passive", severity: "medium" })

  if (mismatchScore > 60)
    signals.push({ signal: "application_mismatch", value: mismatchScore, severity: "high" })
  else if (mismatchScore > 40)
    signals.push({ signal: "application_mismatch", value: mismatchScore, severity: "medium" })

  if (avgModeChanges > 5)
    signals.push({ signal: "rapid_mode_switches", value: Math.round(avgModeChanges), severity: "medium" })

  if (highSaveToApplyRatio)
    signals.push({ signal: "saved_not_applied", value: savedCount, severity: "medium" })

  if (rejectionSpike)
    signals.push({ signal: "rejection_spike", value: `${Math.round(recentRejPct * 100)}%`, severity: "high" })

  // ── Classify state ────────────────────────────────────────────────────────
  let state: BurnoutState["state"]
  let interventionType: BurnoutState["interventionType"]

  const anxious = mismatchScore > 60 && last14 >= 5 && avgModeChanges > 4
  const burntOut = daysSinceLastApplication > 14
  const stalled = daysSinceLastApplication > 7 && daysSinceLastApplication <= 14
  const slowing = applicationVelocityTrend === "decreasing" && last14 > 0

  if (daysSinceLastLogin > 21) {
    state = "burnt_out"
    interventionType = "emergency_reengagement"
  } else if (anxious) {
    state = "anxious"
    interventionType = "gentle_nudge"
  } else if (burntOut) {
    state = "burnt_out"
    interventionType = "rest_suggestion"
  } else if (stalled && rejectionSpike) {
    state = "stalled"
    interventionType = "strategy_reset"
  } else if (stalled) {
    state = "stalled"
    interventionType = "reframe"
  } else if (slowing) {
    state = "slowing"
    interventionType = "gentle_nudge"
  } else {
    state = "healthy"
    interventionType = "none"
  }

  const confidence: BurnoutState["confidence"] =
    apps.length >= 10 ? "high" : apps.length >= 5 ? "medium" : "low"

  const recommendation =
    state === "healthy"
      ? "Keep applying — your pace is solid."
      : state === "slowing"
        ? "Your pace has eased up. Targeting 2–3 strong matches this week would maintain momentum."
        : state === "stalled"
          ? rejectionSpike
            ? "Recent application outcomes have been tough. Refocusing on your highest-match roles may improve results."
            : "Your search has paused for a bit. Resuming with a narrowed focus often works better than broad targeting."
          : state === "burnt_out"
            ? "Taking time away from the search is completely normal. Come back when you feel ready — your pipeline will be here."
            : "You may be casting too wide. Focusing on your top 5 strongest matches tends to be more effective."

  // ── Persist ───────────────────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO public.user_burnout_states
       (user_id, state, confidence, signals, intervention_type, classified_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, now())`,
    [userId, state, confidence, JSON.stringify(signals), interventionType]
  ).catch(() => {}) // non-blocking

  return {
    state,
    confidence,
    signals,
    daysSinceLastApplication,
    daysSinceLastLogin,
    applicationVelocityTrend,
    sessionQualityTrend,
    mismatchScore,
    recommendation,
    interventionType,
  }
}

export async function classifyAllActiveUsers(): Promise<void> {
  const pool = getPostgresPool()
  const result = await pool.query<{ id: string }>(
    `SELECT DISTINCT p.id FROM profiles p
     JOIN job_applications ja ON ja.user_id = p.id
     WHERE ja.updated_at >= NOW() - INTERVAL '30 days'
       AND p.suspended_at IS NULL`
  )
  const results = await Promise.allSettled(result.rows.map((r) => classifyBurnoutState(r.id)))
  const failed = results.filter((r) => r.status === "rejected").length
  console.log(`[burnout] Classified ${result.rows.length} users, ${failed} failed`)
}
