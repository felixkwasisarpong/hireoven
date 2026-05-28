/**
 * Backfill `companies.ats_identifier` with the `{tenant}:{wd}:{site}` triplet
 * the harvester worker needs to claim Workday companies.
 *
 *   npx tsx scripts/backfill-workday-ats-identifier.ts                  # dry-run
 *   npx tsx scripts/backfill-workday-ats-identifier.ts --execute
 *   npx tsx scripts/backfill-workday-ats-identifier.ts --execute --resolve-missing
 *
 * Strategy per company:
 *   1. `detectFromUrl(careers_url)` — works for canonical Workday URLs.
 *   2. Vanity-URL HTML scrape — fetch the careers page and look for embedded
 *      Workday URLs (e.g. `ace.wd5.myworkdayjobs.com/en-US/careers`).
 *   3. If step 2 finds a Workday host but no site, AND `--resolve-missing` is
 *      set, call the live resolver (redirect → sites-api → POST probe).
 *   4. URLs that aren't Workday at all (e.g. `clovis.edu/jobs` mis-tagged) →
 *      flagged with --demote-non-workday to set ats_type = null.
 *
 * The worker's claim filter then picks these up on the next tick.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { workdayAdapter } from "@/lib/harvester/adapters/workday"
import { resolveWorkdaySite } from "@/lib/harvester/discovery/workday-resolver"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const resolveMissing = args.includes("--resolve-missing")
const demoteNonWorkday = args.includes("--demote-non-workday")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "1000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "6", 10))

const WORKDAY_HOST_RE = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/i
// Matches any full Workday host embedded in HTML source, e.g. in href/src/script
const WORKDAY_URL_IN_HTML_RE = /([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com(?:\/[^\s"'<>)]+)?/gi

const VANITY_FETCH_TIMEOUT_MS = 12_000
const VANITY_USER_AGENT = "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)"

async function scrapeWorkdayFromVanityUrl(
  careersUrl: string
): Promise<{ tenant: string; wd: string; site: string | null } | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VANITY_FETCH_TIMEOUT_MS)
    const res = await fetch(careersUrl, {
      headers: { "user-agent": VANITY_USER_AGENT, accept: "text/html" },
      signal: controller.signal,
      redirect: "follow",
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    const html = await res.text()
    // Find all Workday URLs in the HTML and pick the best (with site path > without)
    let bestWithSite: { tenant: string; wd: string; site: string } | null = null
    let bestWithoutSite: { tenant: string; wd: string } | null = null
    let match: RegExpExecArray | null
    WORKDAY_URL_IN_HTML_RE.lastIndex = 0
    while ((match = WORKDAY_URL_IN_HTML_RE.exec(html)) !== null) {
      const tenant = match[1].toLowerCase()
      const wd = match[2].toLowerCase()
      const path = match[0].slice(match[1].length + 1 + match[2].length + ".myworkdayjobs.com".length)
      const detected = workdayAdapter.detectFromUrl(`https://${tenant}.${wd}.myworkdayjobs.com${path}`)
      if (detected) {
        const parts = detected.slug.split(":")
        if (parts.length === 3 && parts[2]) {
          if (!bestWithSite) bestWithSite = { tenant: parts[0], wd: parts[1], site: parts[2] }
        }
      } else if (!bestWithoutSite) {
        bestWithoutSite = { tenant, wd }
      }
    }
    if (bestWithSite) return { ...bestWithSite }
    if (bestWithoutSite) return { ...bestWithoutSite, site: null }
    return null
  } catch {
    return null
  }
}

type CompanyRow = {
  id: string
  name: string
  careers_url: string
  ats_identifier: string | null
}

async function loadCandidates(): Promise<CompanyRow[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CompanyRow>(
    `SELECT id, name, careers_url, ats_identifier
       FROM companies
      WHERE ats_type = 'workday'
        AND status = 'active'
        AND duplicate_of_company_id IS NULL
        AND careers_url IS NOT NULL
        AND (
          ats_identifier IS NULL
          OR ats_identifier !~ '^[a-zA-Z0-9-]+:wd[0-9]+:[A-Za-z0-9_-]+$'
        )
      ORDER BY updated_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  )
  return rows
}

type ResolveOutcome =
  | { kind: "url"; identifier: string }
  | { kind: "scraped"; identifier: string }
  | { kind: "resolved"; identifier: string; source: string }
  | { kind: "not-workday-url"; tenant: null }
  | { kind: "missing-site"; tenant: string; wd: string }
  | { kind: "failed"; reason: string }

async function resolveOne(company: CompanyRow): Promise<ResolveOutcome> {
  // Strategy 1: direct URL detection (canonical Workday URLs)
  const detected = workdayAdapter.detectFromUrl(company.careers_url)
  if (detected) {
    return { kind: "url", identifier: detected.slug }
  }

  // No site in path — check if it's already a bare Workday host.
  let host: string
  try {
    host = new URL(company.careers_url).hostname.toLowerCase()
  } catch {
    return { kind: "not-workday-url", tenant: null }
  }
  const mHost = host.match(WORKDAY_HOST_RE)
  if (mHost) {
    const tenant = mHost[1]
    const wd = mHost[2]
    if (!resolveMissing) return { kind: "missing-site", tenant, wd }
    try {
      const result = await resolveWorkdaySite({ tenant, wd })
      if (!result) return { kind: "failed", reason: "resolver returned null" }
      return { kind: "resolved", identifier: `${tenant}:${wd}:${result.site}`, source: result.source }
    } catch (error) {
      return { kind: "failed", reason: error instanceof Error ? error.message : String(error) }
    }
  }

  // Strategy 2: vanity-URL HTML scrape — fetch the page and look for embedded Workday links.
  if (!resolveMissing) {
    return { kind: "not-workday-url", tenant: null }
  }

  const scraped = await scrapeWorkdayFromVanityUrl(company.careers_url)
  if (!scraped) return { kind: "not-workday-url", tenant: null }

  if (scraped.site) {
    return { kind: "scraped", identifier: `${scraped.tenant}:${scraped.wd}:${scraped.site}` }
  }

  // Found host but no site — try resolver to discover site name.
  try {
    const result = await resolveWorkdaySite({ tenant: scraped.tenant, wd: scraped.wd })
    if (!result) return { kind: "missing-site", tenant: scraped.tenant, wd: scraped.wd }
    return { kind: "resolved", identifier: `${scraped.tenant}:${scraped.wd}:${result.site}`, source: result.source }
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) }
  }
}

async function applyUpdate(companyId: string, identifier: string): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE companies SET ats_identifier = $1, updated_at = now() WHERE id = $2`,
    [identifier, companyId]
  )
}

async function applyDemoteAtsType(companyId: string): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE companies SET ats_type = NULL, updated_at = now() WHERE id = $1`,
    [companyId]
  )
}

async function main() {
  console.log(
    `[backfill-workday] mode=${dryRun ? "dry-run" : "execute"} resolveMissing=${resolveMissing} demoteNonWorkday=${demoteNonWorkday} limit=${limit} concurrency=${concurrency}`
  )

  const candidates = await loadCandidates()
  console.log(`[backfill-workday] loaded ${candidates.length} candidates`)

  let fromUrl = 0
  let fromScrape = 0
  let resolvedRedirect = 0
  let resolvedSitesApi = 0
  let resolvedProbe = 0
  let missingSite = 0
  let notWorkdayUrl = 0
  let demoted = 0
  let failed = 0
  let updated = 0

  const limiter = pLimit(concurrency)
  await Promise.all(
    candidates.map((company) =>
      limiter(async () => {
        const outcome = await resolveOne(company)
        switch (outcome.kind) {
          case "url":
            fromUrl += 1
            if (!dryRun) await applyUpdate(company.id, outcome.identifier)
            updated += dryRun ? 0 : 1
            break
          case "scraped":
            fromScrape += 1
            if (!dryRun) await applyUpdate(company.id, outcome.identifier)
            updated += dryRun ? 0 : 1
            break
          case "resolved":
            if (outcome.source === "redirect") resolvedRedirect += 1
            else if (outcome.source === "sites-api") resolvedSitesApi += 1
            else resolvedProbe += 1
            if (!dryRun) await applyUpdate(company.id, outcome.identifier)
            updated += dryRun ? 0 : 1
            break
          case "missing-site":
            missingSite += 1
            break
          case "not-workday-url":
            notWorkdayUrl += 1
            if (demoteNonWorkday && !dryRun) {
              await applyDemoteAtsType(company.id)
              demoted += 1
            }
            break
          case "failed":
            failed += 1
            break
        }
      })
    )
  )

  console.log(
    `[backfill-workday] fromUrl=${fromUrl} fromScrape=${fromScrape} resolvedRedirect=${resolvedRedirect} resolvedSitesApi=${resolvedSitesApi} resolvedProbe=${resolvedProbe}`
  )
  console.log(
    `[backfill-workday] missingSite=${missingSite} notWorkdayUrl=${notWorkdayUrl} demoted=${demoted} failed=${failed}`
  )
  console.log(`[backfill-workday] updates ${dryRun ? "would have applied" : "applied"}: ${dryRun ? fromUrl + fromScrape + resolvedRedirect + resolvedSitesApi + resolvedProbe : updated}`)

  await getPostgresPool().end()
}

main().catch((error) => {
  console.error("[backfill-workday] fatal:", error)
  process.exit(1)
})
