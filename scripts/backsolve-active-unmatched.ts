/**
 * One-off backfill: backsolve the legacy backlog of ACTIVE-but-unmatched
 * companies (is_active=true, ats_type IS NULL) — overwhelmingly aggregator
 * (Adzuna/Dice) rows that self-healed to active once their jobs landed but
 * never got an ATS resolved.
 *
 * discover-tenants only works inactive placeholders now (prompt 8), and
 * discover-companies' apply-url detection skips aggregator redirector URLs.
 * This script closes that gap by running the redirect-following backsolver
 * (resolveApplyUrlToAtsTenant) over each company's job apply URL and enrolling
 * the resolved board (enrollTenantAsCompany) — the same engine the ingest crons
 * use, just pointed at the existing backlog.
 *
 * It is NOT a cron: new such rows barely accumulate now (ingest backsolves at
 * insert time), so this is a drain-once pass. Idempotent + resumable: --apply
 * stamps last_resolution_attempted_at (1h cooldown) so repeat runs progress.
 *
 *   npx tsx scripts/backsolve-active-unmatched.ts                 # dry run, 200
 *   npx tsx scripts/backsolve-active-unmatched.ts --apply --limit=400
 *   npx tsx scripts/backsolve-active-unmatched.ts --concurrency=4
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { resolveApplyUrlToAtsTenant } from "@/lib/discovery/resolve-apply-url-to-tenant"
import { enrollTenantAsCompany } from "@/lib/discovery/enroll-tenant-as-company"

const APPLY = process.argv.includes("--apply")
const intArg = (name: string, dflt: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  const n = a ? Number.parseInt(a.split("=")[1] ?? "", 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : dflt
}
const LIMIT = intArg("limit", 200)
const CONCURRENCY = intArg("concurrency", 4)

type Candidate = { id: string; name: string; apply_url: string | null; job_count: number }

// Prefer a direct (non-aggregator) apply URL when the company has one — it
// resolves without a redirect hop; otherwise take an aggregator redirector and
// let the backsolver follow it.
const CLAIM_SQL = `
  SELECT c.id, c.name, COALESCE(c.job_count, 0) AS job_count,
    (SELECT j.apply_url FROM jobs j
      WHERE j.company_id = c.id AND j.is_active = true
        AND j.apply_url IS NOT NULL AND j.apply_url <> ''
      ORDER BY (CASE WHEN j.apply_url ILIKE '%adzuna%'
                       OR j.apply_url ILIKE '%dice.com%'
                       OR j.apply_url ILIKE '%indeed%'
                       OR j.apply_url ILIKE '%linkedin%' THEN 1 ELSE 0 END) ASC
      LIMIT 1) AS apply_url
  FROM companies c
  WHERE c.ats_type IS NULL
    AND c.is_active = true
    AND c.duplicate_of_company_id IS NULL
    AND c.status <> 'dead'
    AND (c.last_resolution_attempted_at IS NULL
         OR c.last_resolution_attempted_at < now() - interval '1 hour')
    AND EXISTS (SELECT 1 FROM jobs j
                 WHERE j.company_id = c.id AND j.is_active = true
                   AND j.apply_url IS NOT NULL AND j.apply_url <> '')
  ORDER BY COALESCE(c.job_count, 0) DESC
  LIMIT $1`

async function markResolution(pool: ReturnType<typeof getPostgresPool>, id: string, success: boolean) {
  await pool
    .query(
      `UPDATE companies SET
         resolution_attempts = COALESCE(resolution_attempts, 0) + 1,
         last_resolution_attempted_at = now(),
         last_resolution_failed_at = CASE WHEN $2 THEN NULL ELSE now() END
       WHERE id = $1`,
      [id, success]
    )
    .catch(() => {})
}

async function main() {
  const pool = getPostgresPool()
  const { rows: batch } = await pool.query<Candidate>(CLAIM_SQL, [LIMIT])
  console.log(`${APPLY ? "claim" : "sample"}: ${batch.length} active-unmatched companies  (concurrency ${CONCURRENCY})\n`)
  if (batch.length === 0) {
    await pool.end()
    return
  }

  const counts = { resolved: 0, enrolled: 0, retry_later: 0, no_ats: 0, no_apply_url: 0 }
  const hits: string[] = []
  const limit = pLimit(CONCURRENCY)

  await Promise.all(
    batch.map((co) =>
      limit(async () => {
        if (!co.apply_url) {
          counts.no_apply_url += 1
          if (APPLY) await markResolution(pool, co.id, false)
          return
        }
        const r = await resolveApplyUrlToAtsTenant(co.apply_url, "backfill")
        if (r.success && r.confidence >= 60 && r.atsType && r.atsIdentifier) {
          counts.resolved += 1
          hits.push(`  ${co.name.slice(0, 30).padEnd(30)} ${r.atsType.padEnd(14)} ${r.atsIdentifier.slice(0, 24).padEnd(24)} jobs=${r.jobCount ?? "?"} (${co.job_count} agg)`)
          if (APPLY) {
            const res = await enrollTenantAsCompany(pool, {
              atsType: r.atsType,
              atsIdentifier: r.atsIdentifier,
              confidence: r.confidence,
              jobCount: r.jobCount,
              sourceUrl: co.apply_url,
              sourceType: "backfill:active-unmatched",
              companyNameGuess: co.name,
              domainGuess: r.domainGuess,
            }).catch(() => null)
            if (res?.created) counts.enrolled += 1
            await markResolution(pool, co.id, Boolean(res))
          }
          return
        }
        if (r.errorReason === "no_ats_match") counts.no_ats += 1
        else counts.retry_later += 1
        if (APPLY) await markResolution(pool, co.id, false)
      })
    )
  )

  const pct = (n: number) => `${((n / batch.length) * 100).toFixed(0)}%`
  console.log(`resolved (ATS found, >=60 conf): ${counts.resolved}/${batch.length}  (${pct(counts.resolved)})`)
  console.log(`enrolled                       : ${APPLY ? counts.enrolled : "(dry run)"}`)
  console.log(`no_ats_match                   : ${counts.no_ats}`)
  console.log(`retry_later (transient/board)  : ${counts.retry_later}`)
  console.log(`no_apply_url                   : ${counts.no_apply_url}`)
  if (hits.length) {
    console.log(`\n${APPLY ? "enrolled" : "would-enroll"} sample:`)
    for (const h of hits.slice(0, 30)) console.log(h)
  }
  await pool.end()
}

main().catch((e) => {
  console.error("[backsolve-active-unmatched] failed:", e)
  process.exit(1)
})
