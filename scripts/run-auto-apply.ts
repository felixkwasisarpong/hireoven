/**
 * Execute one overnight auto-apply run.
 *
 *   npx tsx scripts/run-auto-apply.ts --user <uuid>
 *   npx tsx scripts/run-auto-apply.ts --user <uuid> --tz America/Chicago --unproven
 *   npx tsx scripts/run-auto-apply.ts --user <uuid> --submit --outreach
 *
 * Requires the prod DB tunnel: ./scripts/db-tunnel.sh --daemon
 *
 * DRY RUN BY DEFAULT — everything except the submit, recorded as status
 * 'dry_run'. Submission requires BOTH --submit and the environment variable
 * AUTO_APPLY_I_UNDERSTAND=yes, because a flag alone is too easy to leave in a
 * shell history or a cron line. Real applications are sent in a real person's
 * name; that should take deliberate effort every single time.
 */

import { runAutoApplyForUser } from "../lib/apex/auto-apply/worker"
import { getRemainingAllowance } from "../lib/apex/auto-apply/limits"
import { getPostgresPool } from "../lib/postgres/server"
import type { Plan } from "../lib/gates"

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function main() {
  const userId = arg("user")
  if (!userId) throw new Error("--user <uuid> is required")
  const timezone = arg("tz", "UTC")
  const plan = (arg("plan", "pro_max")) as Plan

  const wantsSubmit = process.argv.includes("--submit")
  // Outreach drafts are only ever prepared after a confirmed submit, so this
  // rides on the same confirmation rather than adding a second one.
  const wantsOutreach = process.argv.includes("--outreach")
  const confirmed = process.env.AUTO_APPLY_I_UNDERSTAND === "yes"
  const allowSubmit = wantsSubmit && confirmed
  if (wantsSubmit && !confirmed) {
    console.error("--submit ignored: set AUTO_APPLY_I_UNDERSTAND=yes to actually send applications.")
  }

  const allowance = await getRemainingAllowance(userId, plan, timezone)
  console.log(`user      ${userId}`)
  console.log(`plan      ${plan}  (enabled=${allowance.limits.enabled})`)
  console.log(`caps      ${allowance.limits.weeklyCap}/wk  ${allowance.limits.nightlyCap}/night  $${allowance.limits.monthlyUsdCap}/mo  match>=${allowance.limits.minMatchScore}`)
  console.log(`used      ${allowance.usedThisWeek} this week, ${allowance.usedTonight} tonight, $${allowance.spentThisMonthUsd} this month`)
  console.log(`allowance ${allowance.allowed} (${allowance.reason})`)
  const prepareOutreach = allowSubmit && wantsOutreach
  console.log(`mode      ${allowSubmit ? "*** LIVE SUBMIT ***" : "dry run (nothing is sent)"}`)
  console.log(`outreach  ${prepareOutreach ? "prepare drafts (never sent — you send them yourself)" : "off"}\n`)

  const t = Date.now()
  const res = await runAutoApplyForUser({
    userId, plan, timezone, allowSubmit, prepareOutreach,
    includeUnproven: process.argv.includes("--unproven"),
  })

  console.log(`\n──────── run ${res.runId} ────────`)
  console.log(`attempted     ${res.attempted}`)
  console.log(`submittable   ${res.submittable}   (all required fields filled)`)
  console.log(`bot-walled    ${res.blocked}`)
  console.log(`failed        ${res.failed}`)
  console.log(`submitted     ${res.submitted}   (confirmed by the employer's page)`)
  console.log(`unconfirmed   ${res.submittedUnconfirmed}   (clicked submit, no receipt seen — check your email)`)
  console.log(`outreach      ${res.outreachPrepared} draft sequence(s) queued for your review`)
  console.log(`AI cost       $${res.costUsd.toFixed(5)}`)
  console.log(`stopped       ${res.skippedReason ?? "completed"}`)
  console.log(`elapsed       ${((Date.now() - t) / 1000).toFixed(1)}s`)

  // Read the ledger back, so the run is verified by what was persisted rather
  // than by what the in-process counters claim.
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ status: string; n: string; cov: string | null }>(
    `SELECT status,
            count(*)::text AS n,
            round(avg(required_filled::numeric / NULLIF(required_total, 0)) * 100)::text AS cov
       FROM apex_auto_apply_log
      WHERE run_id = $1
      GROUP BY status
      ORDER BY n DESC`,
    [res.runId],
  ).catch(() => ({ rows: [] as { status: string; n: string; cov: string | null }[] }))
  if (rows.length) {
    console.log(`\nledger:`)
    for (const r of rows) {
      console.log(`  ${r.status.padEnd(10)} ${r.n.padStart(3)}   avg required coverage ${r.cov ?? "-"}%`)
    }
  }
  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
