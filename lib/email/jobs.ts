import { createHash } from "crypto"
import { getPostgresPool } from "@/lib/postgres/server"
import { layoffSourceKind } from "@/lib/h1b/layoff-signal"
import { h1bSponsorPath } from "@/lib/seo/company-seo"
import { generateWeeklyDigest, getWeeklyMovers, isoWeek } from "@/lib/email/digests/weekly"
import { renderWeeklyDigest } from "@/lib/email/templates/weekly-digest"
import { renderLayoffAlert } from "@/lib/email/templates/layoff-alert"
import { renderScorecardMilestone } from "@/lib/email/templates/scorecard-milestone"
import { renderOptExpiration, type OptStage } from "@/lib/email/templates/opt-expiration"
import { generateUnsubscribeToken } from "@/lib/email/unsubscribe"
import { unsubscribeUrl, unsubscribePostUrl, appUrl } from "@/lib/email/templates/layout"
import { sendManaged } from "@/lib/email/provider"

// Spec 08 — email job bodies. These run on the harvester box (8GB) via tsx scripts,
// keeping the DB reads + Resend sends off the memory-constrained web box. The webhook
// stays an HTTP route (Resend calls it); everything cron-shaped lives here.

const shortDate = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d)

// --- Leaderboard rank snapshot (feeds weekly movers) -----------------------
export async function runLeaderboardSnapshot(now = new Date()) {
  const week = isoWeek(now)
  const res = await getPostgresPool().query(
    `INSERT INTO leaderboard_rank_history (company_id, iso_week, rank_volume, rank_cert_rate)
     SELECT company_id, $1, rank_volume, rank_cert_rate FROM h1b_leaderboard_mv
     ON CONFLICT (company_id, iso_week)
     DO UPDATE SET rank_volume = EXCLUDED.rank_volume, rank_cert_rate = EXCLUDED.rank_cert_rate, captured_at = NOW()`,
    [week]
  )
  return { week, rows: res.rowCount ?? 0 }
}

// --- Weekly digest (timezone-local 8am) ------------------------------------
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
function localDayHour(tz: string, now: Date): { day: number; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now)
    const day = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "")
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "")
    if (day < 0 || Number.isNaN(hour)) return null
    return { day, hour }
  } catch {
    return null
  }
}

export async function runWeeklyDigests(now = new Date()) {
  const week = isoWeek(now)
  const pool = getPostgresPool()
  const movers = await getWeeklyMovers(now)

  const { rows } = await pool.query<{ user_id: string; email: string; timezone: string; weekly_send_day: number; weekly_send_hour: number }>(
    `SELECT pr.user_id::text, prof.email, pr.timezone, pr.weekly_send_day, pr.weekly_send_hour
     FROM user_email_preferences pr JOIN profiles prof ON prof.id = pr.user_id
     WHERE pr.weekly_digest = true AND prof.email IS NOT NULL`
  )

  let considered = 0, sent = 0, skippedEmpty = 0
  const results: Record<string, number> = {}
  for (const u of rows) {
    const local = localDayHour(u.timezone, now)
    if (!local || local.day !== u.weekly_send_day || local.hour !== u.weekly_send_hour) continue
    considered++
    const token = await generateUnsubscribeToken(u.user_id, "weekly_digest")
    const data = await generateWeeklyDigest(u.user_id, unsubscribeUrl(token), movers)
    if (!data) { skippedEmpty++; continue }
    const rendered = renderWeeklyDigest(data)
    const r = await sendManaged({
      userId: u.user_id, emailType: "weekly_digest", dedupeKey: `weekly:${u.user_id}:${week}`,
      toEmail: u.email, subject: rendered.subject, html: rendered.html, text: rendered.text, unsubscribeUrl: unsubscribePostUrl(token),
    })
    results[r] = (results[r] ?? 0) + 1
    if (r === "sent") sent++
  }
  return { week, candidates: rows.length, considered, sent, skipped_empty: skippedEmpty, results }
}

// --- Layoff alerts (24h debounce) ------------------------------------------
export async function runLayoffAlerts() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    event_id: string; company_id: string; name: string; source: string; event_date: string
    employees_affected: number | null; location: string | null; user_id: string; email: string; events_12mo: number
  }>(
    `SELECT le.id::text AS event_id, le.company_id::text, c.name, le.source, le.event_date,
            le.employees_affected, le.location, w.user_id::text, prof.email,
            (SELECT COUNT(*) FROM layoff_events le2 WHERE le2.company_id = le.company_id AND le2.event_date > NOW() - INTERVAL '12 months')::int AS events_12mo
     FROM layoff_events le
     JOIN companies c ON c.id = le.company_id
     JOIN watchlist w ON w.company_id = le.company_id
     JOIN profiles prof ON prof.id = w.user_id
     LEFT JOIN user_email_preferences pr ON pr.user_id = w.user_id
     WHERE le.event_date <= CURRENT_DATE AND le.event_date > NOW() - INTERVAL '3 days'
       AND COALESCE(pr.layoff_alerts, true) = true AND prof.email IS NOT NULL
     ORDER BY le.event_date DESC`
  )

  let sent = 0, debounced = 0
  const results: Record<string, number> = {}
  for (const r of rows) {
    const recent = await pool.query(
      `SELECT 1 FROM email_sends WHERE user_id = $1 AND email_type = 'layoff_alert' AND dedupe_key LIKE $2 AND status = 'sent' AND sent_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
      [r.user_id, `layoff:${r.user_id}:${r.company_id}:%`]
    )
    if (recent.rows.length) { debounced++; continue }
    const token = await generateUnsubscribeToken(r.user_id, "layoff_alert")
    const rendered = renderLayoffAlert({
      companyName: r.name, source: layoffSourceKind(r.source), eventDate: shortDate(new Date(r.event_date)),
      employeesAffected: r.employees_affected, location: r.location, nthEvent: r.events_12mo || 1,
      signalUrl: appUrl(h1bSponsorPath(r.company_id, r.name)), rolesUrl: appUrl("/h1b-sponsors/leaderboard"), unsubscribeUrl: unsubscribeUrl(token),
    })
    const res = await sendManaged({
      userId: r.user_id, emailType: "layoff_alert", dedupeKey: `layoff:${r.user_id}:${r.company_id}:${r.event_id}`,
      toEmail: r.email, subject: rendered.subject, html: rendered.html, text: rendered.text, unsubscribeUrl: unsubscribePostUrl(token),
    })
    results[res] = (results[res] ?? 0) + 1
    if (res === "sent") sent++
  }
  return { candidates: rows.length, sent, debounced, results }
}

// --- Scorecard view milestones ---------------------------------------------
const THRESHOLDS = [10, 100, 1000, 10000]
function hashSubject(v: string) { return createHash("sha256").update(v).digest("hex").slice(0, 32) }
async function topDomains(pool: ReturnType<typeof getPostgresPool>, shareToken: string): Promise<string[]> {
  try {
    const { rows } = await pool.query<{ referer_domain: string }>(
      `SELECT referer_domain FROM embed_events WHERE widget_type = 'personal' AND subject_id = $1 AND referer_domain IS NOT NULL GROUP BY referer_domain ORDER BY COUNT(*) DESC LIMIT 3`,
      [hashSubject(shareToken)]
    )
    return rows.map((d) => d.referer_domain)
  } catch {
    return []
  }
}

export async function runScorecardMilestones() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ user_id: string; share_token: string; view_count: number; email: string }>(
    `SELECT ps.user_id::text, ps.share_token, ps.view_count, prof.email
     FROM personal_scorecards ps JOIN profiles prof ON prof.id = ps.user_id
     LEFT JOIN user_email_preferences pr ON pr.user_id = ps.user_id
     WHERE ps.is_public = true AND ps.share_token IS NOT NULL AND prof.email IS NOT NULL AND ps.view_count >= 10
       AND COALESCE(pr.scorecard_milestones, true) = true`
  )
  let sent = 0
  const results: Record<string, number> = {}
  for (const r of rows) {
    let threshold: number | null = null
    for (const t of THRESHOLDS) if (r.view_count >= t) threshold = t
    if (!threshold) continue
    const token = await generateUnsubscribeToken(r.user_id, "scorecard_milestone")
    const rendered = renderScorecardMilestone({
      views: threshold, topDomains: await topDomains(pool, r.share_token),
      cardUrl: appUrl(`/scorecard/${r.share_token}`), embedUrl: appUrl("/dashboard/scorecard"), revokeUrl: appUrl("/dashboard/scorecard"), unsubscribeUrl: unsubscribeUrl(token),
    })
    const res = await sendManaged({
      userId: r.user_id, emailType: "scorecard_milestone", dedupeKey: `milestone:${r.user_id}:${threshold}`,
      toEmail: r.email, subject: rendered.subject, html: rendered.html, text: rendered.text, unsubscribeUrl: unsubscribePostUrl(token),
    })
    results[res] = (results[res] ?? 0) + 1
    if (res === "sent") sent++
  }
  return { candidates: rows.length, sent, results }
}

// --- OPT / STEM-OPT expiration reminders -----------------------------------
const STAGES: OptStage[] = [90, 30, 7]
export async function runOptReminders() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    user_id: string; email: string; opt_end_date: string | null; stem_opt_end_date: string | null; opt_days: number | null; stem_days: number | null
  }>(
    `SELECT pr.user_id::text, prof.email, pr.opt_end_date, pr.stem_opt_end_date,
            (pr.opt_end_date - CURRENT_DATE) AS opt_days, (pr.stem_opt_end_date - CURRENT_DATE) AS stem_days
     FROM user_email_preferences pr JOIN profiles prof ON prof.id = pr.user_id
     WHERE pr.opt_expiration = true AND prof.email IS NOT NULL AND (pr.opt_end_date IS NOT NULL OR pr.stem_opt_end_date IS NOT NULL)`
  )
  let sent = 0
  const results: Record<string, number> = {}
  async function fire(userId: string, email: string, stage: OptStage, isStem: boolean, dateKey: string) {
    const token = await generateUnsubscribeToken(userId, "opt_expiration")
    const rendered = renderOptExpiration({
      stage, isStem, capExemptUrl: appUrl("/h1b-sponsors/leaderboard?cap_exempt_only=true"),
      everifyUrl: appUrl("/h1b-sponsors/leaderboard?e_verify_only=true"), scorecardUrl: appUrl("/dashboard/scorecard"), unsubscribeUrl: unsubscribeUrl(token),
    })
    const res = await sendManaged({
      userId, emailType: "opt_expiration", dedupeKey: `opt:${userId}:${isStem ? "stem" : "opt"}:${stage}:${dateKey}`,
      toEmail: email, subject: rendered.subject, html: rendered.html, text: rendered.text, unsubscribeUrl: unsubscribePostUrl(token),
    })
    results[res] = (results[res] ?? 0) + 1
    if (res === "sent") sent++
  }
  for (const r of rows) {
    if (r.opt_end_date && r.opt_days != null && STAGES.includes(r.opt_days as OptStage)) await fire(r.user_id, r.email, r.opt_days as OptStage, false, r.opt_end_date)
    if (r.stem_opt_end_date && r.stem_days != null && STAGES.includes(r.stem_days as OptStage)) await fire(r.user_id, r.email, r.stem_days as OptStage, true, r.stem_opt_end_date)
  }
  return { candidates: rows.length, sent, results }
}

// --- Queue health / reaper -------------------------------------------------
export async function runEmailQueueHealth() {
  const pool = getPostgresPool()
  const reaped = await pool.query(
    `UPDATE email_sends SET status = 'failed', error_message = COALESCE(error_message, 'reaped: stale queued')
     WHERE status = 'queued' AND queued_at < NOW() - INTERVAL '15 minutes'`
  )
  const { rows: byType } = await pool.query<{ email_type: string; sent: number; bounced: number; failed: number }>(
    `SELECT email_type, COUNT(*) FILTER (WHERE status='sent')::int AS sent, COUNT(*) FILTER (WHERE status='bounced')::int AS bounced, COUNT(*) FILTER (WHERE status='failed')::int AS failed
     FROM email_sends WHERE queued_at > NOW() - INTERVAL '7 days' GROUP BY email_type ORDER BY email_type`
  )
  const { rows: depth } = await pool.query<{ queued: number }>(`SELECT COUNT(*)::int AS queued FROM email_sends WHERE status = 'queued'`)
  const alerts: string[] = []
  for (const t of byType) {
    const total = t.sent + t.bounced + t.failed
    if (total >= 20 && t.bounced / total > 0.03) alerts.push(`${t.email_type}: bounce rate ${(100 * t.bounced / total).toFixed(1)}%`)
  }
  if ((depth[0]?.queued ?? 0) > 5000) alerts.push(`queue depth ${depth[0].queued}`)
  return { reaped: reaped.rowCount ?? 0, queue_depth: depth[0]?.queued ?? 0, by_type: byType, alerts }
}
