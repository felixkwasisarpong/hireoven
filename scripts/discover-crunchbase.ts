/**
 * Crunchbase organization → ATS discovery.
 *
 *   npx tsx scripts/discover-crunchbase.ts                       # dry-run
 *   npx tsx scripts/discover-crunchbase.ts --execute
 *   npx tsx scripts/discover-crunchbase.ts --execute --limit=50
 *   npx tsx scripts/discover-crunchbase.ts --query="developer tools" --execute
 *
 * Requires CRUNCHBASE_API_KEY in the environment. Pulls funded-org domains from
 * the Crunchbase Search API (see VERIFY LIVE note in crunchbase-feeder.ts),
 * then for each domain fetches https://<domain>/careers and
 * https://<domain>/jobs and runs extractCandidates() (reused from github-seeds)
 * to find adapter-matched ATS URLs. Each candidate is enrolled via
 * enrollFromApplyUrl() with discovered_via='apply-url:crunchbase'. Dry-run by
 * default; pass --execute to write.
 */

import { loadEnvConfig } from "@next/env"
import { fetchCrunchbaseDomains } from "@/lib/harvester/discovery/crunchbase-feeder"
import { extractCandidates } from "@/lib/harvester/discovery/github-seeds"
import { enrollFromApplyUrl } from "@/lib/harvester/discovery/enroll-from-apply-url"
import { getPostgresPool } from "@/lib/postgres/server"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const queryArg = args.find((a) => a.startsWith("--query="))?.slice("--query=".length)
const limitArg = args.find((a) => a.startsWith("--limit="))
const limit = limitArg ? Math.max(1, Number(limitArg.slice("--limit=".length))) : 100

const source = "crunchbase"
const PROBE_TIMEOUT_MS = 8_000
const USER_AGENT =
  "Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)"

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
  const apiKey = process.env.CRUNCHBASE_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("CRUNCHBASE_API_KEY is required in the environment")
  }

  console.log(
    `[discover-crunchbase] mode=${dryRun ? "dry-run" : "execute"} limit=${limit}${queryArg ? ` query="${queryArg}"` : ""}`
  )

  const { domains } = await fetchCrunchbaseDomains({ apiKey, query: queryArg, limit })
  console.log(`[discover-crunchbase] company domains to probe: ${domains.length}`)

  const pool = dryRun ? null : getPostgresPool()
  const stats = { enrolled: 0, updated: 0, none: 0, noCandidate: 0, errors: 0 }

  for (const domain of domains) {
    try {
      const candidates = []
      for (const path of ["careers", "jobs"]) {
        const html = await fetchHtml(`https://${domain}/${path}`)
        if (html) candidates.push(...extractCandidates(html))
      }
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
          `${dryRun ? "[dry-run] " : ""}${domain} -> enroll ${candidate.atsType} ${candidate.careersUrl}`
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
        `[discover-crunchbase] error for ${domain}:`,
        error instanceof Error ? error.message : error
      )
    }
  }

  console.log(
    `[discover-crunchbase] enrolled=${stats.enrolled} updated=${stats.updated} no-candidate=${stats.noCandidate} none=${stats.none} errors=${stats.errors}`
  )
  if (pool) await pool.end()
}

main().catch((error) => {
  console.error("[discover-crunchbase] fatal:", error)
  process.exit(1)
})
