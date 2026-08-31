/**
 * GET /api/cron/auto-apply — the overnight run.
 *
 * Sweeps users who have auto-apply enabled and runs one batch each, respecting
 * their weekly, nightly and dollar caps. Every decision is owned by a module
 * that fails closed on its own, so this route is scheduling and bookkeeping.
 *
 * DRY BY DEFAULT. Nothing is submitted unless AUTO_APPLY_ALLOW_SUBMIT=true is
 * set in the environment AND the plan's row in auto_apply_limits is enabled.
 * Two switches in different places on purpose: neither a stray env var nor a
 * single DB flag can start sending applications on its own.
 *
 * "Overnight" is per user, not per server. The window is evaluated in each
 * user's own timezone, so a run does not fire mid-afternoon for someone in
 * another region — the whole premise is that this happens while they sleep.
 *
 * Runs on the private app-worker, NOT the public web app: the image ships
 * Chromium (see Dockerfile) and a browser session per application is far too
 * heavy for the box serving the site. Schedule it from the harvester box:
 *
 *   0 * * * * APP_URL=http://localhost:3100 CRON_SECRET=... \
 *     bash scripts/crons.sh auto-apply >/dev/null 2>&1
 *
 * Hourly rather than nightly so every timezone's window is eventually reached;
 * the per-user "already ran tonight" check decides who actually runs, which is
 * what makes an hourly schedule safe.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { runAutoApplyForUser } from "@/lib/apex/auto-apply/worker"
import type { Plan } from "@/lib/gates"

export const runtime = "nodejs"
export const maxDuration = 300

/**
 * Browser work is slow and serial — roughly 20s per application, up to a
 * nightly cap of 5 each. Three users is about 300s worst case, which is the
 * route's own ceiling; more would be truncated mid-run and leave the ledger
 * disagreeing with what actually happened.
 */
const MAX_USERS_PER_RUN = 3

/** Local hours that count as "while you sleep". */
const WINDOW_START_HOUR = 1
const WINDOW_END_HOUR = 6

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const allowSubmit = process.env.AUTO_APPLY_ALLOW_SUBMIT === "true"
  const pool = getPostgresPool()

  // Candidates: an enabled plan, the user opted in, inside their own night
  // window, and no run tonight already. That last check is what makes an
  // hourly schedule safe — a user is picked up once per night, not once
  // per hour.
  const { rows: users } = await pool.query<{
    user_id: string; plan: string; timezone: string | null
  }>(
    // Two things this query has to get right, both of which it got wrong first
    // time and both of which failed SILENTLY — the sweep selected nobody while
    // reporting success.
    //
    //   Plan names differ between storage and code. Pro Max is stored as
    //   "pro_international" (see lib/billing/fulfillment.ts), so joining
    //   auto_apply_limits on the raw value never matched a single row.
    //
    //   Users have many subscription rows — the test account has eight, seven
    //   of them canceled. Joining them all would fan out and let a canceled
    //   subscription grant access, so only the newest live one counts.
    `WITH live AS (
       SELECT DISTINCT ON (s.user_id)
              s.user_id,
              CASE WHEN s.plan = 'pro_international' THEN 'pro_max' ELSE s.plan END AS plan
         FROM subscriptions s
        WHERE s.status IN ('active', 'trialing', 'past_due', 'unpaid')
        ORDER BY s.user_id, s.created_at DESC
     )
     SELECT p.id AS user_id, l.plan, COALESCE(p.timezone, 'UTC') AS timezone
       FROM profiles p
       JOIN live ON live.user_id = p.id
       JOIN auto_apply_limits l ON l.plan = live.plan
      WHERE l.enabled
        AND COALESCE((p.auto_apply_prefs->>'enabled')::boolean, false)
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE COALESCE(p.timezone, 'UTC')))
            BETWEEN $1 AND $2
        AND NOT EXISTS (
          SELECT 1 FROM apex_auto_apply_log al
           WHERE al.user_id = p.id
             AND al.applied_at >= date_trunc('day', now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))
        )
      ORDER BY p.id
      LIMIT $3`,
    [WINDOW_START_HOUR, WINDOW_END_HOUR, MAX_USERS_PER_RUN],
  ).catch((err) => {
    // Loudly. A swallowed error here is indistinguishable from "nobody is
    // eligible tonight", and that is exactly how two missing columns and a
    // plan-name mismatch went unnoticed: the sweep reported success every hour
    // while selecting nobody.
    console.error("[cron/auto-apply] user selection failed:", err)
    return { rows: [] as { user_id: string; plan: string; timezone: string | null }[] }
  })

  const results: Record<string, unknown>[] = []
  for (const u of users) {
    try {
      const r = await runAutoApplyForUser({
        userId: u.user_id,
        plan: u.plan as Plan,
        timezone: u.timezone ?? "UTC",
        allowSubmit,
      })
      results.push({
        userId: u.user_id, runId: r.runId, attempted: r.attempted,
        submittable: r.submittable, blocked: r.blocked, failed: r.failed,
        costUsd: Number(r.costUsd.toFixed(5)), stopped: r.skippedReason,
      })
    } catch (err) {
      // One user's run must never take down the sweep for everyone behind them.
      results.push({
        userId: u.user_id,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    mode: allowSubmit ? "live" : "dry_run",
    usersConsidered: users.length,
    results,
  })
}
