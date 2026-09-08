/**
 * Queue the post-submit outreach drafts for an auto-apply run.
 *
 *   npx tsx scripts/prepare-outreach-for-run.ts --run <uuid> [--user <uuid>]
 *
 * The worker only prepares drafts for rows it recorded as 'applied', so a run
 * that ended 'submitted_unconfirmed' queues nothing — the applications may well
 * have landed, and the user is left with no follow-up to send. This backfills
 * those drafts from the ledger.
 *
 * Drafts only. Nothing is sent here or anywhere else: outreach is written for
 * the user to review, edit, and send themselves (lib/apex/outreach/types.ts).
 *
 * Requires the prod DB tunnel: ./scripts/db-tunnel.sh --daemon
 */

import { preparePostSubmitOutreach } from "@/lib/apex/auto-apply/post-submit-outreach"
import { getPostgresPool } from "@/lib/postgres/server"

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/** Statuses where an application plausibly reached the employer. */
const SUBMITTED = ["applied", "submitted_unconfirmed"]

async function main() {
  const runId = arg("run")
  if (!runId) throw new Error("--run <uuid> is required")
  const userFilter = arg("user")

  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    user_id: string; job_id: string; company: string | null; job_title: string | null; status: string
  }>(
    `SELECT user_id, job_id, company, job_title, status
       FROM apex_auto_apply_log
      WHERE run_id = $1
        AND status = ANY($2)
        AND ($3 = '' OR user_id = $3::uuid)
      ORDER BY company`,
    [runId, SUBMITTED, userFilter],
  )

  if (!rows.length) {
    console.log("no submitted rows in that run — nothing to prepare")
    await pool.end()
    return
  }

  let created = 0
  for (const r of rows) {
    const res = await preparePostSubmitOutreach({
      userId: r.user_id,
      jobId: r.job_id,
      companyName: r.company ?? "the company",
      jobTitle: r.job_title ?? "the role",
      pool,
    })
    created += res?.created ?? 0
    console.log(
      `${(r.company ?? "?").padEnd(18)} ${r.status.padEnd(22)} created=${res?.created ?? 0} skipped=${res?.skipped ?? 0}`,
    )
  }
  console.log(`\n${created} draft sequence(s) queued. Review and send them yourself — nothing was sent.`)
  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
