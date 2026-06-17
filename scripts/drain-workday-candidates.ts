/**
 * Drain the parked Workday tenant backlog.
 *
 * `discover-companies` (the daily 300s serverless cron) can only afford to call
 * resolveWorkdaySite() on WORKDAY_CRTSH_RESOLVE_LIMIT (=20) tenants per run.
 * Every other Workday tenant crt.sh surfaces is parked in discovered_candidates
 * as `{tenant}:{wd}:unresolved` and never resolved — so thousands of enterprise
 * Workday boards (the highest jobs-per-board source) sit idle.
 *
 * This is the off-box drain worker the `idx_dc_retry` index was built for. It
 * has no 300s budget: it runs on the harvester box (8GB) and works through the
 * whole backlog. For each parked tenant it resolves the Workday *site* name,
 * job-gates the resolved board (only enroll boards with >=1 live job), and
 * enrolls it as a company row. The tiered harvester then polls it on its own.
 *
 * Resolution outcomes per candidate:
 *   - resolved + has jobs  → enroll into companies, mark candidate enrolled
 *   - resolved, no jobs    → hold (back off next_retry_at; board may be empty now)
 *   - unresolved           → back off; reject after REJECT_AFTER_DAYS of trying
 *
 *   npx tsx scripts/drain-workday-candidates.ts                     # DRY RUN, 500 tenants
 *   npx tsx scripts/drain-workday-candidates.ts --apply
 *   npx tsx scripts/drain-workday-candidates.ts --apply --limit=2000 --concurrency=4
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { resolveWorkdaySite } from "@/lib/harvester/discovery/workday-resolver"
import { humanizeSeedSlug } from "@/lib/discovery/seed-slug"

const APPLY = process.argv.includes("--apply")
const intArg = (name: string, dflt: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  const n = a ? Number.parseInt(a.split("=")[1] ?? "", 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : dflt
}
const LIMIT = intArg("limit", 500)
// Workday WAFs throttle bursts to one tenant host; keep outer concurrency low.
// Each tenant is a different host, so a handful in flight is safe.
const CONCURRENCY = intArg("concurrency", 4)
const PROBE_TIMEOUT_MS = 8_000
const RESOLVE_TIMEOUT_MS = 8_000
// Stop retrying a tenant that never resolves; park it as rejected so the
// retry query stops returning it.
const REJECT_AFTER_DAYS = 30
const HOLD_BACKOFF_DAYS = 7

type Candidate = {
  id: string
  ats_identifier: string
  created_at: string
  age_days: number
}

/** Does the resolved Workday board currently expose >=1 live job? */
async function boardHasJobs(careersUrl: string): Promise<boolean> {
  const det = detectAdapter(careersUrl)
  if (!det || det.adapter.name !== "workday") return false
  try {
    const res = await det.adapter.fetchJobs({
      slug: det.slug,
      ctx: { etag: null, lastModified: null, timeoutMs: PROBE_TIMEOUT_MS },
    })
    return res.jobs.length > 0
  } catch {
    return false
  }
}

async function main() {
  const pool = getPostgresPool()

  const { rows: candidates } = await pool.query<Candidate>(
    `SELECT id, ats_identifier, created_at,
            EXTRACT(EPOCH FROM (now() - created_at)) / 86400 AS age_days
       FROM discovered_candidates
      WHERE ats_type = 'workday'
        AND ats_identifier LIKE '%:unresolved'
        AND enrolled_company_id IS NULL
        AND rejected_reason IS NULL
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY confidence_score DESC, created_at ASC
      LIMIT $1`,
    [LIMIT]
  )

  // A tenant may have been enrolled by another channel since it was staged.
  const { rows: known } = await pool.query<{ tenant: string }>(
    `SELECT DISTINCT lower(split_part(ats_identifier, ':', 1)) AS tenant
       FROM companies
      WHERE ats_type = 'workday' AND ats_identifier IS NOT NULL`
  )
  const knownTenants = new Set(known.map((r) => r.tenant).filter(Boolean))

  console.log(
    `${APPLY ? "DRAINING" : "DRY RUN — would drain"} ${candidates.length} parked Workday tenants ` +
      `(limit=${LIMIT}, concurrency=${CONCURRENCY})\n`
  )

  const stats = { enrolled: 0, heldNoJobs: 0, unresolved: 0, rejected: 0, alreadyKnown: 0, errors: 0 }
  const limit = pLimit(CONCURRENCY)

  await Promise.all(
    candidates.map((c) =>
      limit(async () => {
        const [tenant, wd] = c.ats_identifier.split(":")
        if (!tenant || !wd) {
          stats.errors++
          return
        }

        if (knownTenants.has(tenant.toLowerCase())) {
          // Tenant already harvested under another site — retire the stub.
          stats.alreadyKnown++
          if (APPLY) {
            await pool
              .query(
                `UPDATE discovered_candidates
                    SET rejected_reason = 'tenant_already_enrolled', updated_at = now()
                  WHERE id = $1`,
                [c.id]
              )
              .catch(() => {})
          }
          return
        }

        let resolved
        try {
          resolved = await resolveWorkdaySite({ tenant, wd, timeoutMs: RESOLVE_TIMEOUT_MS })
        } catch {
          resolved = null
        }

        // ── Unresolved ────────────────────────────────────────────────────────
        if (!resolved) {
          if (c.age_days >= REJECT_AFTER_DAYS) {
            stats.rejected++
            if (APPLY) {
              await pool
                .query(
                  `UPDATE discovered_candidates
                      SET rejected_reason = 'workday_unresolved', updated_at = now()
                    WHERE id = $1`,
                  [c.id]
                )
                .catch(() => {})
            }
          } else {
            stats.unresolved++
            if (APPLY) {
              await pool
                .query(
                  `UPDATE discovered_candidates
                      SET next_retry_at = now() + ($2 || ' days')::interval, updated_at = now()
                    WHERE id = $1`,
                  [c.id, String(HOLD_BACKOFF_DAYS)]
                )
                .catch(() => {})
            }
          }
          return
        }

        const slug = `${tenant.toLowerCase()}:${wd}:${resolved.site}`
        const careersUrl = canonicalCareersUrl("workday", slug)
        if (!careersUrl) {
          stats.errors++
          return
        }

        // ── Resolved but no live jobs — hold, don't enroll an empty board ──────
        if (!(await boardHasJobs(careersUrl))) {
          stats.heldNoJobs++
          if (APPLY) {
            await pool
              .query(
                `UPDATE discovered_candidates
                    SET next_retry_at = now() + ($2 || ' days')::interval,
                        verified_at = now(), updated_at = now()
                  WHERE id = $1`,
                [c.id, String(HOLD_BACKOFF_DAYS)]
              )
              .catch(() => {})
          }
          return
        }

        // ── Resolved + has jobs → enroll ──────────────────────────────────────
        const name = humanizeSeedSlug("workday", slug)
        const domain = `${tenant.toLowerCase()}.${wd}.myworkdayjobs.com`

        if (!APPLY) {
          stats.enrolled++
          console.log(`  [dry] ${slug}  (${resolved.source})  → ${careersUrl}`)
          return
        }

        try {
          const r = await pool.query<{ id: string }>(
            `INSERT INTO companies
               (name, domain, careers_url, ats_type, ats_identifier,
                status, freshness_tier, discovered_via, is_active, next_harvest_at)
             VALUES ($1,$2,$3,'workday',$4,'active','tier_3','script:drain-workday-candidates',true, now())
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [name, domain, careersUrl, slug]
          )
          if (r.rowCount && r.rowCount > 0) {
            stats.enrolled++
            knownTenants.add(tenant.toLowerCase())
            // Mark the stub enrolled so the retry index stops returning it.
            await pool
              .query(
                `UPDATE discovered_candidates
                    SET enrolled_company_id = $1, verified_at = now(), updated_at = now()
                  WHERE id = $2`,
                [r.rows[0].id, c.id]
              )
              .catch(() => {})
          } else {
            // Lost an enroll race (domain already present) — retire the stub.
            stats.alreadyKnown++
            await pool
              .query(
                `UPDATE discovered_candidates
                    SET rejected_reason = 'tenant_already_enrolled', updated_at = now()
                  WHERE id = $1`,
                [c.id]
              )
              .catch(() => {})
          }
        } catch {
          stats.errors++
        }
      })
    )
  )

  console.log(
    `\nDONE — enrolled=${stats.enrolled} heldNoJobs=${stats.heldNoJobs} ` +
      `unresolved=${stats.unresolved} rejected=${stats.rejected} ` +
      `alreadyKnown=${stats.alreadyKnown} errors=${stats.errors}`
  )

  if (APPLY) {
    await pool
      .query(
        `INSERT INTO discovery_runs (channel, candidates_found, candidates_enrolled, candidates_held, candidates_rejected)
         VALUES ('drain:workday', $1, $2, $3, $4)`,
        [
          candidates.length,
          stats.enrolled,
          stats.heldNoJobs + stats.unresolved,
          stats.rejected,
        ]
      )
      .catch(() => {})
  } else {
    console.log("\nDry run — use --apply to enroll and update candidate state.")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
