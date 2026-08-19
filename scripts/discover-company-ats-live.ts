/**
 * Live ATS discovery by fetching company careers pages and scanning ATS signatures.
 *
 * Usage:
 *   npx tsx scripts/discover-company-ats-live.ts --limit=300
 *   npx tsx scripts/discover-company-ats-live.ts --limit=300 --dry-run
 *   npx tsx scripts/discover-company-ats-live.ts --include-inactive --reactivate-on-discovery
 *
 * Notes:
 * - Requires network access.
 * - This script updates companies.ats_type when detection confidence is high/medium.
 * - Existing non-custom ats_type values are preserved unless --overwrite is passed.
 */

import { loadEnvConfig } from "@next/env"
import type { Pool } from "pg"
import { detectAtsFromHtml } from "../lib/companies/ats-signatures"
import { detectAtsFromUrl, type AtsType as DetectedAtsType } from "../lib/companies/detect-ats"
import { getPostgresPool } from "../lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const overwrite = args.includes("--overwrite")
const includeInactive = args.includes("--include-inactive")
const reactivateOnDiscovery = args.includes("--reactivate-on-discovery")
const limitArg = args.find((arg) => arg.startsWith("--limit="))
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? "1200"))
const concurrency = 10

type CompanyRow = {
  id: string
  name: string
  domain: string
  careers_url: string
  ats_type: string | null
  is_active: boolean
}

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)",
      },
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const PLACEHOLDER_DOMAIN_SUFFIXES = [".uscis-employer", ".lca-employer"]
const LEGAL_SUFFIX_RE =
  /\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|partners)\b/gi

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
}

function isPlaceholderDomain(domain: string): boolean {
  return PLACEHOLDER_DOMAIN_SUFFIXES.some((suffix) =>
    domain.endsWith(suffix)
  )
}

const ATS_DISCOVERY_EXCLUDED_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "indeed.com",
  "www.indeed.com",
  "glassdoor.com",
  "www.glassdoor.com",
  "ziprecruiter.com",
  "www.ziprecruiter.com",
  "monster.com",
  "www.monster.com",
])

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function companySlugCandidates(company: CompanyRow): string[] {
  const out = new Set<string>()
  const add = (value: string | null | undefined) => {
    if (!value) return
    const cleaned = value.trim()
    if (cleaned.length < 2) return
    out.add(cleaned)
  }

  const normalizedDomain = normalizeDomain(company.domain)
  if (normalizedDomain && !isPlaceholderDomain(normalizedDomain)) {
    const root = normalizedDomain.split(".")[0] ?? ""
    add(slugify(root))
    add(slugify(root.replace(/-/g, "")))
  }

  try {
    const host = normalizeDomain(new URL(company.careers_url).hostname)
    if (
      host &&
      !isPlaceholderDomain(host) &&
      !isExcludedDiscoveryHost(host)
    ) {
      const root = host.split(".")[0] ?? ""
      add(slugify(root))
      add(slugify(root.replace(/-/g, "")))
    }
  } catch {
    // ignore malformed careers URL
  }

  const normalizedName = company.name.replace(LEGAL_SUFFIX_RE, " ")
  const nameSlug = slugify(normalizedName)
  add(nameSlug)
  add(nameSlug.replace(/-/g, ""))

  return [...out]
}

function buildCandidateUrls(company: CompanyRow): string[] {
  const out = new Set<string>()
  out.add(company.careers_url)

  try {
    const parsed = new URL(company.careers_url)
    const origin = parsed.origin
    out.add(origin)
    out.add(`${origin}/careers`)
    out.add(`${origin}/jobs`)
    out.add(`${origin}/careers/`)
    out.add(`${origin}/jobs/`)
  } catch {
    // ignore malformed careers URL
  }

  for (const slug of companySlugCandidates(company)) {
    out.add(`https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`)
    out.add(`https://jobs.lever.co/${encodeURIComponent(slug)}`)
  }

  return [...out]
}

function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return ""
  }
}

function isExcludedDiscoveryHost(hostname: string): boolean {
  if (!hostname) return false
  return (
    ATS_DISCOVERY_EXCLUDED_HOSTS.has(hostname) ||
    [...ATS_DISCOVERY_EXCLUDED_HOSTS].some((blocked) =>
      hostname.endsWith(`.${blocked}`)
    )
  )
}

function isAshbyGenericFallback(html: string): boolean {
  const normalized = html.toLowerCase()
  return (
    normalized.includes("window.__appdata") &&
    normalized.includes('"organization":null') &&
    normalized.includes('"jobboard":null')
  )
}

function isLeverNotFoundHtml(html: string): boolean {
  const normalized = html.toLowerCase()
  return (
    normalized.includes("404 error") &&
    normalized.includes("sorry, we couldn't find anything here")
  )
}

function extractMetaText(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
  const ogSiteMatch = html.match(
    /<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i
  )?.[1] ?? ""
  const ogTitleMatch = html.match(
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i
  )?.[1] ?? ""
  return `${titleMatch} ${ogSiteMatch} ${ogTitleMatch}`.toLowerCase()
}

function isSandboxLikePage(html: string): boolean {
  const text = extractMetaText(html)
  return /\b(sandbox|demo|sample|example|staging|qa|testing)\b/i.test(text)
}

function isFalsePositiveCandidate({
  candidateUrl,
  html,
  atsType,
}: {
  candidateUrl: string
  html: string
  atsType: string
}): boolean {
  const host = hostnameOf(candidateUrl)
  if (host === "jobs.ashbyhq.com" && atsType === "ashby") {
    return isAshbyGenericFallback(html) || isSandboxLikePage(html)
  }
  if (host === "jobs.lever.co" && atsType === "lever") {
    return isLeverNotFoundHtml(html) || isSandboxLikePage(html)
  }
  return false
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = []
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const current = idx
      idx += 1
      const result = await tasks[current]()
      results.push(result)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, tasks.length) }).map(() => worker())
  )
  return results
}

async function main() {
  const pool = getPostgresPool()

  const activeFilter = includeInactive ? "" : "AND is_active = true"
  const { rows: companiesData } = await pool.query<CompanyRow>(
    `SELECT id, name, domain, careers_url, ats_type, is_active
       FROM companies
      WHERE careers_url IS NOT NULL
        ${activeFilter}
      ORDER BY updated_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  )

  const companies = companiesData
  console.log(`Loaded ${companies.length} companies for ATS discovery.`)

  // Pull apply_urls grouped by company so we can detect ATS from existing
  // job links (cheaper than fetching candidate careers pages).
  const { rows: jobsData } = await pool.query<{
    company_id: string | null
    apply_url: string | null
  }>(
    `SELECT company_id, apply_url
       FROM jobs
      WHERE is_active = true
        AND apply_url IS NOT NULL
      LIMIT 100000`
  )

  const applyUrlsByCompany = new Map<string, string[]>()
  for (const row of jobsData) {
    if (!row.company_id || !row.apply_url) continue
    const list = applyUrlsByCompany.get(row.company_id) ?? []
    list.push(row.apply_url)
    applyUrlsByCompany.set(row.company_id, list)
  }

  await runDiscovery({
    companies,
    pool,
    dryRun,
    overwrite,
    reactivateOnDiscovery,
    applyUrlsByCompany,
  })

  await pool.end()
}

async function runDiscovery({
  companies,
  pool,
  dryRun,
  overwrite,
  reactivateOnDiscovery,
  applyUrlsByCompany,
}: {
  companies: CompanyRow[]
  pool: Pool
  dryRun: boolean
  overwrite: boolean
  reactivateOnDiscovery: boolean
  applyUrlsByCompany: Map<string, string[]>
}) {
  let discovered = 0
  let updated = 0
  let skipped = 0
  let reactivated = 0

  const tasks = companies.map((company) => async () => {
    const existingType = company.ats_type?.toLowerCase() ?? null
    if (!overwrite && existingType && existingType !== "custom" && existingType !== "unknown") {
      skipped += 1
      return
    }

    // Widened beyond AtsEvidence because detectAtsFromUrl covers providers that
    // have no HTML signature rule (e.g. Rippling). Only `atsType` reaches the DB
    // and it is written as text, so the extra members are safe here.
    let detection:
      | { atsType: DetectedAtsType; confidence: "high" | "medium" | "low"; reasons: string[] }
      | null = null

    const applyHits = (applyUrlsByCompany.get(company.id) ?? [])
      .map((url) => detectAtsFromUrl(url))
      .filter((hit): hit is NonNullable<typeof hit> => Boolean(hit))
    if (applyHits.length > 0) {
      detection = {
        atsType: applyHits[0].atsType,
        confidence: applyHits[0].confidence,
        reasons: ["Detected from existing apply_url patterns"],
      }
    }

    if (!detection) {
      const candidateUrls = buildCandidateUrls(company)
      for (const candidate of candidateUrls) {
        const candidateHost = hostnameOf(candidate)
        if (isExcludedDiscoveryHost(candidateHost)) continue

        const html = await fetchHtml(candidate)
        if (!html) continue
        const hit = detectAtsFromHtml({ url: candidate, html })
        if (!hit) continue
        if (
          isFalsePositiveCandidate({
            candidateUrl: candidate,
            html,
            atsType: hit.atsType,
          })
        ) {
          continue
        }
        detection = hit
        break
      }
    }

    if (!detection) {
      skipped += 1
      return
    }

    discovered += 1
    console.log(
      `${dryRun ? "[dry-run] " : ""}${company.name} (${company.domain}) -> ${detection.atsType} [${detection.confidence}]${!company.is_active && reactivateOnDiscovery ? " +reactivate" : ""}`
    )

    if (dryRun) return

    const shouldReactivate = !company.is_active && reactivateOnDiscovery
    try {
      await pool.query(
        shouldReactivate
          ? `UPDATE companies
                SET ats_type = $1, is_active = true, updated_at = now()
              WHERE id = $2`
          : `UPDATE companies
                SET ats_type = $1, updated_at = now()
              WHERE id = $2`,
        [detection.atsType, company.id]
      )
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message}`)
      return
    }
    updated += 1
    if (shouldReactivate) reactivated += 1
  })

  await runWithConcurrency(tasks, concurrency)

  console.log(
    `\nDone. discovered=${discovered}, updated=${dryRun ? 0 : updated}, skipped=${skipped}, reactivated=${dryRun ? 0 : reactivated}`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
