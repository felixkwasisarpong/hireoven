/**
 * Backfill `companies.ats_identifier` for iCIMS companies that have a vanity
 * careers URL (not an *.icims.com hostname). Fetches each page's HTML and
 * looks for embedded iCIMS subdomain links.
 *
 *   npx tsx scripts/backfill-icims-ats-identifier.ts            # dry-run
 *   npx tsx scripts/backfill-icims-ats-identifier.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { icimsAdapter } from "@/lib/harvester/adapters/icims"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "500", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "5", 10))

const ICIMS_IN_HTML_RE = /([a-z0-9-]+\.icims\.com)(?:\/[^\s"'<>)]*)?/gi
const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)"

// iCIMS subdomains that are not job boards
const ICIMS_SKIP_HOSTS = new Set([
  "www.icims.com", "cdn.icims.com", "i.icims.com", "api.icims.com",
  "developer.icims.com", "images.icims.com", "image.icims.com",
  "community.icims.com", "partners.icims.com", "trust.icims.com",
  "legal.icims.com", "cookie-policy-scripts.icims.com",
])

type CompanyRow = {
  id: string
  name: string
  careers_url: string
}

async function loadCandidates(): Promise<CompanyRow[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CompanyRow>(
    `SELECT id, name, careers_url
       FROM companies
      WHERE ats_type = 'icims'
        AND status = 'active'
        AND duplicate_of_company_id IS NULL
        AND careers_url IS NOT NULL
        AND ats_identifier IS NULL
      ORDER BY updated_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  )
  return rows
}

// Score a candidate iCIMS host for preference (higher = better)
function scoreIcimsHost(host: string): number {
  const sub = host.replace(/\.icims\.com$/, "").toLowerCase()
  if (/career/.test(sub)) return 3
  if (/\bjob/.test(sub) || /talent/.test(sub) || /hire/.test(sub)) return 2
  if (/^internal-/.test(sub)) return 1
  if (/^(partner|event|fr|global|uk|me|india|us)-/.test(sub)) return 0
  return 1
}

async function scrapeIcimsHost(careersUrl: string): Promise<string | null> {
  try {
    // Check if the URL itself is already an iCIMS URL
    const detected = icimsAdapter.detectFromUrl(careersUrl)
    if (detected) return detected.slug

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(careersUrl, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal: controller.signal,
      redirect: "follow",
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return null

    // Also check the final URL after redirects
    const finalDetected = icimsAdapter.detectFromUrl(res.url)
    if (finalDetected) return finalDetected.slug

    const html = await res.text()
    ICIMS_IN_HTML_RE.lastIndex = 0
    let match: RegExpExecArray | null
    const candidates: string[] = []
    while ((match = ICIMS_IN_HTML_RE.exec(html)) !== null) {
      const host = match[1].toLowerCase()
      if (ICIMS_SKIP_HOSTS.has(host)) continue
      const sub = host.replace(/\.icims\.com$/, "")
      if (sub.length <= 2) continue
      if (/^cdn\d*$/.test(sub) || /^person$/.test(sub)) continue
      if (/^(alumni|retiree|login|signin|faculty|employee)-/.test(sub)) continue
      if (!candidates.includes(host)) candidates.push(host)
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => scoreIcimsHost(b) - scoreIcimsHost(a))
    return candidates[0]
  } catch {
    return null
  }
}

async function applyUpdate(companyId: string, identifier: string): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE companies SET ats_identifier = $1, updated_at = now() WHERE id = $2`,
    [identifier, companyId]
  )
}

async function main() {
  console.log(`[backfill-icims] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency}`)
  const candidates = await loadCandidates()
  console.log(`[backfill-icims] loaded ${candidates.length} candidates`)

  let found = 0
  let notFound = 0
  let updated = 0

  const limiter = pLimit(concurrency)
  await Promise.all(
    candidates.map((company) =>
      limiter(async () => {
        const host = await scrapeIcimsHost(company.careers_url)
        if (host) {
          found += 1
          console.log(`[backfill-icims] found ${company.name} → ${host}`)
          if (!dryRun) {
            await applyUpdate(company.id, host)
            updated += 1
          }
        } else {
          notFound += 1
          console.log(`[backfill-icims] miss  ${company.name} (${company.careers_url})`)
        }
      })
    )
  )

  console.log(`[backfill-icims] found=${found} notFound=${notFound}`)
  console.log(`[backfill-icims] updates ${dryRun ? "would have applied" : "applied"}: ${dryRun ? found : updated}`)
  await getPostgresPool().end()
}

main().catch((error) => {
  console.error("[backfill-icims] fatal:", error)
  process.exit(1)
})
