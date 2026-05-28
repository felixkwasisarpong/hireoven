/**
 * Backfill `companies.ats_identifier` for Greenhouse companies that have a
 * vanity careers URL. Fetches each page's HTML and looks for embedded
 * boards.greenhouse.io/{slug} or job-boards.greenhouse.io/{slug} references.
 *
 *   npx tsx scripts/backfill-greenhouse-ats-identifier.ts            # dry-run
 *   npx tsx scripts/backfill-greenhouse-ats-identifier.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { extractGreenhouseBoardToken } from "@/lib/companies/greenhouse-url"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "500", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "5", 10))

// Match boards.greenhouse.io/{slug} or job-boards.greenhouse.io/{slug} (with optional path/query)
const GH_IN_HTML_RE =
  /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9][a-z0-9_-]*)/gi
const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)"

const SKIP_SLUGS = new Set(["embed", "boards", "job-boards", "boards-api", "api"])

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
      WHERE ats_type = 'greenhouse'
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

async function scrapeGreenhouseSlug(careersUrl: string): Promise<string | null> {
  try {
    // Direct extraction first (handles already-greenhouse URLs)
    const direct = extractGreenhouseBoardToken(careersUrl)
    if (direct) return direct

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(careersUrl, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal: controller.signal,
      redirect: "follow",
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return null

    // Final URL check after redirects
    const finalDirect = extractGreenhouseBoardToken(res.url)
    if (finalDirect) return finalDirect

    const html = await res.text()
    GH_IN_HTML_RE.lastIndex = 0
    let match: RegExpExecArray | null
    const seen = new Map<string, number>()
    while ((match = GH_IN_HTML_RE.exec(html)) !== null) {
      const slug = match[1].toLowerCase()
      if (SKIP_SLUGS.has(slug)) continue
      seen.set(slug, (seen.get(slug) ?? 0) + 1)
    }
    if (seen.size === 0) return null
    // Pick most-mentioned slug (most likely the actual board)
    return [...seen.entries()].sort((a, b) => b[1] - a[1])[0][0]
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
  console.log(`[backfill-greenhouse] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency}`)
  const candidates = await loadCandidates()
  console.log(`[backfill-greenhouse] loaded ${candidates.length} candidates`)

  let found = 0
  let notFound = 0
  let updated = 0

  const limiter = pLimit(concurrency)
  await Promise.all(
    candidates.map((company) =>
      limiter(async () => {
        const slug = await scrapeGreenhouseSlug(company.careers_url)
        if (slug) {
          found += 1
          console.log(`[backfill-greenhouse] found ${company.name} -> ${slug}`)
          if (!dryRun) {
            await applyUpdate(company.id, slug)
            updated += 1
          }
        } else {
          notFound += 1
          console.log(`[backfill-greenhouse] miss  ${company.name} (${company.careers_url})`)
        }
      })
    )
  )

  console.log(`[backfill-greenhouse] found=${found} notFound=${notFound}`)
  console.log(`[backfill-greenhouse] updates ${dryRun ? "would have applied" : "applied"}: ${dryRun ? found : updated}`)
  await getPostgresPool().end()
}

main().catch((error) => {
  console.error("[backfill-greenhouse] fatal:", error)
  process.exit(1)
})
