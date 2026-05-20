/**
 * One-shot: scan every claim-eligible company, detect the ones whose adapter
 * cannot be resolved, and push their `next_harvest_at` 24h out. Mirrors the
 * runtime fix applied in lib/harvester/run-harvest.ts for the `matched:false`
 * branch, but applied in bulk so a redeployed worker starts on healthy rows
 * instead of churning through the existing backlog one batch at a time.
 *
 * Usage:
 *   npx tsx scripts/cooldown-adapter-mismatches.ts            # dry run (default)
 *   npx tsx scripts/cooldown-adapter-mismatches.ts --apply    # write next_harvest_at
 *   npx tsx scripts/cooldown-adapter-mismatches.ts --apply --hours=48
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter, type AtsName } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"

const SUPPORTED_ATS_TYPES = [
  "greenhouse","lever","ashby","smartrecruiters","workable","workday",
  "recruitee","teamtailor","personio","bamboohr","jazzhr","jobvite",
  "icims","successfactors","taleo","oraclecloud","usajobs","infosys","apple",
]

// Same predicate as worker.ts CLAIM_QUERY, minus the lease/FOR UPDATE bits.
// Selects every row a normal tick *would* try to claim — including the ones
// scheduled in the future, since we want a complete picture.
const SCAN_QUERY = `
SELECT id, name, careers_url, direct_ats_url, ats_type, ats_identifier, next_harvest_at
FROM companies
WHERE status = 'active'
  AND is_active = true
  AND duplicate_of_company_id IS NULL
  AND careers_url IS NOT NULL
  AND (
    ats_type = ANY($1::text[])
    OR careers_url ILIKE 'https://boards.greenhouse.io/%'
    OR careers_url ILIKE 'https://job-boards.greenhouse.io/%'
    OR careers_url ILIKE 'https://jobs.lever.co/%'
    OR careers_url ILIKE 'https://jobs.ashbyhq.com/%'
    OR careers_url ILIKE 'https://jobs.smartrecruiters.com/%'
    OR careers_url ILIKE 'https://careers.smartrecruiters.com/%'
    OR careers_url ILIKE 'https://apply.workable.com/%'
    OR careers_url ILIKE 'https://jobs.workable.com/%'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.wd[0-9]{1,3}\\.myworkdayjobs\\.com/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.recruitee\\.com/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.teamtailor\\.com/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.jobs\\.personio\\.(com|de)/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.bamboohr\\.com/'
    OR careers_url ~* '^https?://[a-z0-9-]+\\.applytojob\\.com/'
    OR careers_url ILIKE 'https://jobs.jobvite.com/%'
    OR careers_url ILIKE 'https://digitalcareers.infosys.com/%'
    OR careers_url ILIKE 'https://jobs.apple.com/%'
  )
`

type Row = {
  id: string
  name: string
  careers_url: string
  direct_ats_url: string | null
  ats_type: string | null
  ats_identifier: string | null
  next_harvest_at: Date | null
}

function detectAdapterForRow(row: Row): AtsName | null {
  const detectionUrl = row.direct_ats_url?.trim() || row.careers_url
  const fromUrl = detectAdapter(detectionUrl)
  if (fromUrl) return fromUrl.adapter.name

  const atsType = row.ats_type?.trim()
  const atsIdentifier = row.ats_identifier?.trim()
  if (!atsType || !atsIdentifier) return null

  const canonical = canonicalCareersUrl(atsType as AtsName, atsIdentifier)
  if (!canonical) return null
  const canonHit = detectAdapter(canonical)
  return canonHit?.adapter.name ?? null
}

function flagNumber(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (!direct) return fallback
  const parsed = Number.parseInt(direct.slice(prefix.length), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  const apply = process.argv.includes("--apply")
  const hours = flagNumber("hours", 24)
  const cooldownSec = hours * 3600

  const pool = getPostgresPool()
  try {
    const { rows } = await pool.query<Row>(SCAN_QUERY, [SUPPORTED_ATS_TYPES])
    console.log(`Claim-eligible companies scanned: ${rows.length}`)

    const mismatched: Row[] = []
    for (const row of rows) {
      if (!detectAdapterForRow(row)) mismatched.push(row)
    }

    const now = Date.now()
    const eligibleNow = mismatched.filter(
      (r) => !r.next_harvest_at || r.next_harvest_at.getTime() <= now
    )
    const futureCooldown = mismatched.filter(
      (r) => r.next_harvest_at && r.next_harvest_at.getTime() > now
    )

    console.log(`Mismatched total: ${mismatched.length}`)
    console.log(`  - eligible right now: ${eligibleNow.length}`)
    console.log(`  - already scheduled in future: ${futureCooldown.length}`)

    const byAts = new Map<string, number>()
    for (const r of mismatched) {
      const key = r.ats_type ?? "(null)"
      byAts.set(key, (byAts.get(key) ?? 0) + 1)
    }
    console.log(`\nBy ats_type:`)
    for (const [k, v] of [...byAts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(18)} ${v}`)
    }

    if (mismatched.length === 0) {
      console.log("\nNothing to do.")
      return
    }

    if (!apply) {
      console.log(`\n[dry-run] Would push ${mismatched.length} rows to next_harvest_at = now() + ${hours}h.`)
      console.log(`Re-run with --apply to commit.`)
      return
    }

    // Push every mismatched row (eligible or not) to at least `now() + hours`.
    // GREATEST() preserves any longer existing cooldown so we never *shorten*
    // an already-scheduled gap.
    const ids = mismatched.map((r) => r.id)
    const updateResult = await pool.query(
      `UPDATE companies
       SET next_harvest_at = GREATEST(
         COALESCE(next_harvest_at, now()),
         now() + ($2 || ' seconds')::interval
       )
       WHERE id = ANY($1::uuid[])`,
      [ids, cooldownSec]
    )
    console.log(`\nUpdated next_harvest_at on ${updateResult.rowCount ?? 0} rows.`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
