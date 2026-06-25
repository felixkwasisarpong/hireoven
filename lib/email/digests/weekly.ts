import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { getCompanyLayoffSignalsBatch } from "@/lib/h1b/layoff-signal-query"
import { appUrl } from "@/lib/email/templates/layout"
import type { WeeklyDigestData } from "@/lib/email/templates/weekly-digest"

// Spec 08 — weekly digest generator. Returns null when the user has no content this
// week (NEVER send an empty digest). Movers are intentionally omitted in v1: a real
// week-over-week leaderboard mover list needs historical rank snapshots we don't yet
// keep, and fabricating "top sponsors" every week is noise, not signal.

export function isoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

function prevIsoWeek(date = new Date()): string {
  return isoWeek(new Date(date.getTime() - 7 * 86400000))
}

function shortDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date)
}

export async function generateWeeklyDigest(
  userId: string,
  unsubscribeUrl: string
): Promise<WeeklyDigestData | null> {
  if (!hasPostgresEnv()) return null
  const pool = getPostgresPool()
  const now = new Date()

  // 1. Scorecard + week-over-week delta.
  let scorecard: WeeklyDigestData["scorecard"]
  const sc = await pool.query<{ total_score: number; grade: string }>(
    `SELECT total_score, grade FROM personal_scorecards WHERE user_id = $1 LIMIT 1`,
    [userId]
  )
  if (sc.rows[0]) {
    const last = await pool.query<{ total_score: number }>(
      `SELECT total_score FROM personal_scorecard_history WHERE user_id = $1 AND iso_week = $2 LIMIT 1`,
      [userId, prevIsoWeek(now)]
    )
    const delta = last.rows[0] ? sc.rows[0].total_score - last.rows[0].total_score : null
    scorecard = {
      score: sc.rows[0].total_score,
      grade: sc.rows[0].grade,
      delta,
      recomputeUrl: appUrl("/dashboard/scorecard"),
      stale: false,
    }
    // Snapshot this week's score for next week's delta (idempotent per ISO week).
    await pool.query(
      `INSERT INTO personal_scorecard_history (user_id, iso_week, total_score, grade)
       VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, iso_week) DO NOTHING`,
      [userId, isoWeek(now), sc.rows[0].total_score, sc.rows[0].grade]
    )
  }

  // 2. Watched companies + current layoff signal.
  const watchedRows = await pool.query<{ company_id: string; name: string }>(
    `SELECT w.company_id::text, c.name FROM watchlist w JOIN companies c ON c.id = w.company_id WHERE w.user_id = $1 ORDER BY c.name LIMIT 25`,
    [userId]
  )
  const watchedIds = watchedRows.rows.map((r) => r.company_id)
  let watched: WeeklyDigestData["watched"]
  if (watchedIds.length) {
    const signals = await getCompanyLayoffSignalsBatch(watchedIds)
    watched = watchedRows.rows.map((r) => {
      const sig = signals.get(r.company_id)
      const label = sig && sig.level !== "stable" ? sig.label : null
      return { name: r.name, rankChange: null, layoffChange: label }
    })
  }

  // 3. Recent layoff events on watched companies (last 7 days).
  let layoffs: WeeklyDigestData["layoffs"]
  if (watchedIds.length) {
    const ev = await pool.query<{ name: string; event_date: string; employees_affected: number | null }>(
      `SELECT c.name, le.event_date, le.employees_affected
       FROM layoff_events le JOIN companies c ON c.id = le.company_id
       WHERE le.company_id = ANY($1::uuid[]) AND le.event_date > NOW() - INTERVAL '7 days'
       ORDER BY le.event_date DESC LIMIT 5`,
      [watchedIds]
    )
    if (ev.rows.length) {
      layoffs = ev.rows.map((r) => ({
        name: r.name,
        date: shortDate(new Date(r.event_date)),
        affected: r.employees_affected,
      }))
    }
  }

  // 4. Editorial pick.
  let editorial: WeeklyDigestData["editorial"]
  const ed = await pool.query<{ title: string; url: string; blurb: string | null }>(
    `SELECT title, url, blurb FROM weekly_editorial_picks
     WHERE (active_from IS NULL OR active_from <= CURRENT_DATE) AND (active_to IS NULL OR active_to >= CURRENT_DATE)
     ORDER BY created_at DESC LIMIT 1`
  )
  if (ed.rows[0]) editorial = ed.rows[0]

  // NEVER send an empty digest.
  const hasContent = Boolean(scorecard) || (watched?.length ?? 0) > 0 || (layoffs?.length ?? 0) > 0
  if (!hasContent) return null

  // Dynamic subject — lead with the single most interesting fact.
  const date = shortDate(now)
  let subject: string
  if (scorecard && scorecard.delta && scorecard.delta !== 0) {
    subject = `Hireoven Weekly — ${date}: your scorecard is now ${scorecard.grade}`
  } else if (layoffs?.length) {
    subject = `Hireoven Weekly — ${date}: ${layoffs.length} layoff event${layoffs.length > 1 ? "s" : ""} on your watched companies`
  } else if (watched?.length) {
    subject = `Hireoven Weekly — ${date}: ${watched.length} compan${watched.length > 1 ? "ies" : "y"} you're watching`
  } else {
    subject = `Hireoven Weekly — ${date}: this week in H-1B sponsorship`
  }

  return {
    subject,
    preheader: "Your weekly H-1B sponsorship brief.",
    scorecard,
    watched,
    layoffs,
    editorial,
    unsubscribeUrl,
  }
}
