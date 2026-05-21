/**
 * For each stuck-inactive brand-name company (Cloudflare-blocked careers
 * page, generic HTML scraper returns 0 jobs), probe Workday's `/wday/cxs`
 * API for candidate tenant slugs derived from the company name/domain.
 * The Workday API isn't behind Cloudflare, so we can reach it directly.
 *
 * For each match, run resolveWorkdaySite() to discover the named site,
 * then update the company row to point at the Workday tenant — the
 * harvester will pick it up next tick.
 *
 * Defaults to dry-run.
 *
 * Usage:
 *   npx tsx scripts/discover-workday-for-stuck-companies.ts
 *   npx tsx scripts/discover-workday-for-stuck-companies.ts --execute
 *   npx tsx scripts/discover-workday-for-stuck-companies.ts --execute --limit=20
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { resolveWorkdaySite } from "@/lib/harvester/discovery/workday-resolver"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const limit = Number.parseInt(
  args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "200",
  10
)

const WD_SHARDS = ["1", "2", "3", "5", "10", "12"]

type StuckRow = {
  id: string
  name: string
  domain: string
}

function candidateTenants(row: StuckRow): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const v = s.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (v && !seen.has(v) && v.length >= 3 && v.length <= 30) {
      seen.add(v)
      out.push(v)
    }
  }
  // domain stem (drop trailing TLD)
  const domHost = row.domain.toLowerCase().replace(/\.[a-z]{2,}$/, "")
  push(domHost)
  // hyphen-stripped (parker-hannifin -> parkerhannifin), and first segment
  push(domHost.replace(/-/g, ""))
  push(domHost.split("-")[0] ?? "")
  // name-derived variants
  const lname = row.name.toLowerCase()
  push(lname.replace(/[^a-z0-9]/g, ""))                       // "trader joe's" -> "traderjoes"
  push(lname.split(/[^a-z0-9]+/)[0] ?? "")                    // first word
  return out
}

async function probeTenantShards(tenant: string): Promise<{ tenant: string; wd: string } | null> {
  for (const wd of WD_SHARDS) {
    const url = `https://${tenant}.wd${wd}.myworkdayjobs.com/wday/cxs/${tenant}/sites`
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch(url, { method: "GET", signal: ctrl.signal })
      clearTimeout(t)
      if (res.status === 200) return { tenant, wd }
    } catch {
      // ignore
    }
  }
  return null
}

async function findWorkdayMatch(row: StuckRow): Promise<{
  tenant: string
  wd: string
  site: string
  source: string
} | null> {
  for (const candidate of candidateTenants(row)) {
    const hit = await probeTenantShards(candidate)
    if (!hit) continue
    const resolved = await resolveWorkdaySite({ tenant: hit.tenant, wd: `wd${hit.wd}` })
    if (resolved) return { ...hit, site: resolved.site, source: resolved.source }
    // tenant found but no site resolved — still useful, callers can default to
    // "External". Mark with synthetic source so we don't claim a real resolution.
    return { ...hit, site: "External", source: "tenant-only" }
  }
  return null
}

async function main() {
  const pool = getPostgresPool()

  const { rows } = await pool.query<StuckRow>(
    `SELECT id, name, domain
       FROM companies
      WHERE is_active = false
        AND duplicate_of_company_id IS NULL
        AND last_crawled_at IS NOT NULL
        AND COALESCE(job_count, 0) = 0
        AND COALESCE(ats_type, 'none') IN ('none', 'custom')
        AND domain NOT ILIKE '%.uscis-employer'
        AND domain NOT ILIKE '%.lca-employer'
        AND domain NOT ILIKE '%.scout-placeholder'
      ORDER BY name
      LIMIT $1`,
    [limit]
  )

  console.log(`[wd-discover] mode=${execute ? "execute" : "dry-run"}  candidates=${rows.length}`)

  const limiter = pLimit(8)
  let matched = 0
  let unresolved = 0

  await Promise.all(
    rows.map((row) =>
      limiter(async () => {
        const match = await findWorkdayMatch(row)
        if (!match) {
          unresolved += 1
          return
        }
        matched += 1
        const careersUrl = `https://${match.tenant}.wd${match.wd}.myworkdayjobs.com/en-US/${match.site}`
        const identifier = `${match.tenant}:wd${match.wd}:${match.site}`
        console.log(
          `  ✓ ${row.name.padEnd(40)} → ${match.tenant}.wd${match.wd} (site=${match.site}, via ${match.source})`
        )
        if (execute) {
          await pool
            .query(
              `UPDATE companies
                  SET ats_type = 'workday',
                      ats_identifier = $1,
                      direct_ats_url = $2,
                      direct_ats_provider = 'workday',
                      direct_ats_identifier = $1,
                      careers_url = $2,
                      is_active = true,
                      updated_at = NOW()
                WHERE id = $3`,
              [identifier, careersUrl, row.id]
            )
            .catch((err) =>
              console.warn(`    update failed for ${row.id}:`, err instanceof Error ? err.message : err)
            )
        }
      })
    )
  )

  console.log(`\n[wd-discover] done matched=${matched}  unresolved=${unresolved}/${rows.length}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
