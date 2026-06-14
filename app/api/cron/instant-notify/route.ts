/**
 * GET /api/cron/instant-notify
 *
 * Drives instant alerts/push for harvester-ingested jobs. The Supabase database
 * webhook only fires for Supabase-cloud inserts; the self-hosted harvester
 * bulk-inserts directly, so its jobs never reached the instant pipeline. This
 * cron closes that gap: every few minutes it sweeps jobs first detected inside a
 * lookback window and runs each through the shared processNotifications().
 *
 * Idempotent (alert_notifications dedup), so an overlapping window can't double-
 * notify. Bounded (window + LIMIT) so a big crawl can't trigger a storm.
 *
 * Schedule (crontab on the box), e.g. every 5 minutes:
 *   *\/5 * * * * curl -fsS -H "authorization: Bearer $CRON_SECRET" \
 *     https://hireoven.com/api/cron/instant-notify >/dev/null 2>&1
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { processNotifications } from "@/lib/alerts/instant-notify"
import type { Job } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

/** Lookback window in minutes. Wider than the cron interval so a missed run is
 *  covered; dedup makes the overlap harmless. */
export function instantNotifyWindowMinutes(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.INSTANT_NOTIFY_WINDOW_MIN ?? "20")
  return Number.isFinite(n) && n > 0 ? Math.min(n, 180) : 20
}

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
        AND is_active = true
        AND ${sqlPublishedJob("jobs")}
      ORDER BY first_detected_at ASC
      LIMIT ${MAX_JOBS_PER_RUN}`,
    [windowMin],
  )

  let processed = 0
  for (const job of rows) {
    await processNotifications(job)
    processed += 1
  }

  return NextResponse.json({ ok: true, windowMin, candidates: rows.length, processed })
}
