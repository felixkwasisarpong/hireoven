/**
 * VC portfolio-page discovery.
 *
 *   npx tsx scripts/discover-vc-portfolios.ts            # dry-run (default)
 *   npx tsx scripts/discover-vc-portfolios.ts --execute
 *   npx tsx scripts/discover-vc-portfolios.ts --execute --limit=50
 *   npx tsx scripts/discover-vc-portfolios.ts --source=https://fund.example/portfolio/
 *
 * For each curated portfolio page we scrape the external company domains, then
 * for each domain fetch https://<domain>/careers and https://<domain>/jobs and
 * run extractCandidates() (reused from github-seeds) to find any adapter-matched
 * ATS URL. Each found candidate is enrolled via enrollFromApplyUrl() with
 * discovered_via='apply-url:vc-portfolio:<fund>'. Dry-run by default; pass
 * --execute to write. --limit caps the total number of domains probed.
 */

import { loadEnvConfig } from "@next/env"
import {
  DEFAULT_VC_PORTFOLIOS,
  fetchPortfolioDomains,
  type VcPortfolioSource,
} from "@/lib/harvester/discovery/vc-portfolios"
import { extractCandidates } from "@/lib/harvester/discovery/github-seeds"
import { enrollFromApplyUrl } from "@/lib/harvester/discovery/enroll-from-apply-url"
import { getPostgresPool } from "@/lib/postgres/server"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const sourceOverrides = args
  .filter((a) => a.startsWith("--source="))
  .map((a) => a.slice("--source=".length))
  .filter(Boolean)
const limitArg = args.find((a) => a.startsWith("--limit="))
const limit = limitArg ? Math.max(1, Number(limitArg.slice("--limit=".length))) : Infinity

const PROBE_TIMEOUT_MS = 8_000
const USER_AGENT =
  "Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)"

const sources: VcPortfolioSource[] = sourceOverrides.length
  ? sourceOverrides.map((url, idx) => ({ name: `cli-source-${idx}`, url }))
  : DEFAULT_VC_PORTFOLIOS

function fundSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function titleCaseFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT },
    })
    return res.ok ? await res.text() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log(
    `[discover-vc-portfolios] mode=${dryRun ? "dry-run" : "execute"} sources=${sources.length}`
  )

  // Gather unique company domains across all portfolios, tagged with the first
  // fund that surfaced each one (for telemetry on the enroll source).
  const domainToFund = new Map<string, string>()
  for (const source of sources) {
    console.log(`[discover-vc-portfolios] fetching ${source.name} …`)
    const domains = await fetchPortfolioDomains(source)
    console.log(`[discover-vc-portfolios] ${source.name}: domains=${domains.length}`)
    for (const domain of domains) {
      if (!domainToFund.has(domain)) domainToFund.set(domain, source.name)
    }
  }

  let domains = [...domainToFund.keys()]
  if (limit !== Infinity) domains = domains.slice(0, limit)
  console.log(`[discover-vc-portfolios] unique company domains to probe: ${domains.length}`)

  const pool = dryRun ? null : getPostgresPool()
  const stats = { enrolled: 0, updated: 0, none: 0, noCandidate: 0, errors: 0 }

  for (const domain of domains) {
    try {
      const fund = domainToFund.get(domain) ?? "unknown"
      const source = `vc-portfolio:${fundSlug(fund)}`

      const candidates = []
      for (const path of ["careers", "jobs"]) {
        const html = await fetchHtml(`https://${domain}/${path}`)
        if (html) candidates.push(...extractCandidates(html))
      }
      // Dedupe by (atsType, slug).
      const seen = new Set<string>()
      const unique = candidates.filter((c) => {
        const key = `${c.atsType}:${c.slug}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      if (unique.length === 0) {
        stats.noCandidate += 1
        continue
      }

      for (const candidate of unique) {
        console.log(
          `${dryRun ? "[dry-run] " : ""}${domain} -> enroll ${candidate.atsType} ${candidate.careersUrl} (${source})`
        )
        if (!dryRun && pool) {
          const r = await enrollFromApplyUrl(pool, {
            companyName: titleCaseFromDomain(domain),
            applyUrl: candidate.careersUrl,
            companyDomain: domain,
            logoUrl: companyLogoUrlFromDomain(domain) || null,
            source,
          })
          if (r?.enrolled) stats.enrolled += 1
          else if (r) stats.updated += 1
          else stats.none += 1
        }
      }
    } catch (error) {
      stats.errors += 1
      console.error(
        `[discover-vc-portfolios] error for ${domain}:`,
        error instanceof Error ? error.message : error
      )
    }
  }

  console.log(
    `[discover-vc-portfolios] enrolled=${stats.enrolled} updated=${stats.updated} no-candidate=${stats.noCandidate} none=${stats.none} errors=${stats.errors}`
  )
  if (pool) await pool.end()
}

main().catch((error) => {
  console.error("[discover-vc-portfolios] fatal:", error)
  process.exit(1)
})
