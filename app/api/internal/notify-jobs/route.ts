/**
 * POST /api/internal/notify-jobs
 *
 * Event-driven instant notifications. The harvester POSTs the IDs of jobs it
 * just inserted; the app (which holds the VAPID / Resend keys) matches them
 * against alerts/watchlists + the sponsor-match push and sends. This is the
 * primary trigger — an alert fires the moment a matching job is harvested.
 * /api/cron/instant-notify is the periodic safety net.
 *
 * Body: { jobIds: string[] }   Auth: CRON_SECRET bearer.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { sqlNotificationFreshnessDate } from "@/lib/alerts/job-freshness"
import { getPostgresPool } from "@/lib/postgres/server"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { processNotifications } from "@/lib/alerts/instant-notify"
import { instantNotifyWindowMinutes } from "@/lib/alerts/instant-notify-window"
import type { Job } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

const MAX_IDS = 500

export async function POST(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // When alert accumulation is on (default), the /api/cron/instant-notify sweep
  // is the SOLE accumulator: it filters the whole jobs table by first_detected_at
  // across BOTH the harvester and the crawler, so every source's jobs batch
  // together over the window. This per-batch real-time path only sees ONE
  // source's current insert — sending from it would start the accumulation
  // cooldown and starve the other source's jobs (the "crawl-only" symptom).
  // So when accumulation is enabled, defer entirely to the sweep.
  if ((process.env.ALERT_ACCUMULATE_MINUTES ?? "60") !== "0") {
    return NextResponse.json({ ok: true, deferred: "accumulation-sweep", processed: 0 })
  }

  const body = (await request.json().catch(() => ({}))) as { jobIds?: unknown }
  const ids = Array.isArray(body.jobIds)
    ? body.jobIds.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS)
    : []
  if (ids.length === 0) return NextResponse.json({ ok: true, processed: 0 })

  const pool = getPostgresPool()
  const windowMin = instantNotifyWindowMinutes()
  // Lean column set — only what the matcher + senders read (no raw_data).
  const { rows } = await pool.query<Job>(
    `SELECT id, title, company_id, location, normalized_title, employment_type,
            seniority_level, skills, sponsors_h1b, sponsorship_score, requires_authorization,
            apply_url, is_remote, is_hybrid, first_detected_at, posted_at, salary_min, salary_max
       FROM jobs
      WHERE id = ANY($1::uuid[])
        AND is_active = true
        AND ${sqlPublishedJob("jobs")}
        AND ${sqlNotificationFreshnessDate("jobs")} > now() - make_interval(mins => $2)`,
    [ids, windowMin],
  )

  // One batch call so a user matching many of these jobs gets one combined
  // email + one summary push, not a ping per job.
  await processNotifications(rows)

  return NextResponse.json({ ok: true, requested: ids.length, processed: rows.length, windowMin })
}
