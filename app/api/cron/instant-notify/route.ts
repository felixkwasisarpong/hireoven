/**
 * GET /api/cron/instant-notify  (safety-net sweep)
 *
 * The PRIMARY trigger is event-driven: the harvester POSTs new job IDs to
 * /api/internal/notify-jobs the moment it inserts them (see notify-trigger.ts).
 * This cron is the fallback — it catches anything the event path missed (the
 * harvester couldn't reach the app, a non-harvester insert path, etc.) by
 * sweeping jobs first detected inside a lookback window and running each through
 * the shared processNotifications().
 *
 * Idempotent (alert_notifications dedup), so re-processing a job the event path
 * already handled can't double-notify. Bounded (window + LIMIT) so it can't storm.
 *
 * Schedule (crontab on the box), e.g. every 5 minutes:
 *   *\/5 * * * * curl -fsS -H "authorization: Bearer $CRON_SECRET" \
 *     https://hireoven.com/api/cron/instant-notify >/dev/null 2>&1
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

const MAX_JOBS_PER_RUN = 500

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const windowMin = instantNotifyWindowMinutes()
  const pool = getPostgresPool()

  // Lean column set: only what the matcher + senders read (no raw_data).
  const { rows } = await pool.query<Job>(
    `SELECT id, title, company_id, location, normalized_title, employment_type,
            seniority_level, skills, sponsors_h1b, sponsorship_score, requires_authorization,
            apply_url, is_remote, is_hybrid, first_detected_at, posted_at, salary_min, salary_max
       FROM jobs
      WHERE first_detected_at > now() - make_interval(mins => $1)
        AND ${sqlNotificationFreshnessDate("jobs")} > now() - make_interval(mins => $1)
        AND is_active = true
        AND ${sqlPublishedJob("jobs")}
      ORDER BY first_detected_at ASC
      LIMIT ${MAX_JOBS_PER_RUN}`,
    [windowMin],
  )

  // One batch call so each user gets one combined notification across the
  // window's jobs, not a separate ping per job.
  await processNotifications(rows)

  return NextResponse.json({ ok: true, windowMin, candidates: rows.length, processed: rows.length })
}
