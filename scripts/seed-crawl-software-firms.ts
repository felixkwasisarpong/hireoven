/**
 * Upsert, crawl, and immigration-link software firms from curated seed lists.
 *
 * Scope:
 * - Filters seed rows to software-focused industries.
 * - Upserts companies in Postgres.
 * - Crawls and persists jobs for selected domains.
 * - For companies with jobs, links matching H1B/LCA rows with deterministic rules.
 *
 * Usage:
 *   npx tsx scripts/seed-crawl-software-firms.ts
 *   npx tsx scripts/seed-crawl-software-firms.ts --execute
 *   npx tsx scripts/seed-crawl-software-firms.ts --execute --limit=150 --concurrency=8
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"
import { detectAtsFromUrl } from "@/lib/companies/detect-ats"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"
import { normalizeEmployerName } from "@/lib/h1b/normalize-employer"
import {
  COMPANY_SEED_ROWS,
  type CompanySize,
  type SeedExtra,
} from "./data/company-seeds"
import { EXPANSION_SEED_ROWS } from "./data/company-seeds-expansion"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((arg) => arg.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0) return process.argv[index + 1]
  return undefined
}

const execute = process.argv.includes("--execute")
const limit = Math.max(0, Number(flag("limit")) || 0) || undefined
const concurrency = Math.max(1, Number(flag("concurrency")) || 8)
const reportPath =
  flag("report") ||
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `software-seed-crawl-report-${new Date().toISOString().slice(0, 10)}.json`
  )

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500)
  return String(error).slice(0, 500)
}

let uncaughtExceptionCount = 0
let unhandledRejectionCount = 0

process.on("uncaughtException", (error) => {
  const message = sanitizeError(error)
  if (message.includes("Controller is already closed")) return
  uncaughtExceptionCount += 1
  console.error(`[software-seed] uncaughtException: ${message}`)
})

process.on("unhandledRejection", (reason) => {
  const message = sanitizeError(reason)
  if (message.includes("Controller is already closed")) return
  unhandledRejectionCount += 1
  console.error(`[software-seed] unhandledRejection: ${message}`)
})

type SeedTuple =
  | readonly [string, string, string, string, CompanySize]
  | readonly [string, string, string, string, CompanySize, SeedExtra]

type SeedRow = {
  name: string
  domain: string
  careers_url: string
  industry: string
  size: CompanySize
  ats_type: string
  ats_identifier: string | null
  sponsors_h1b: boolean
  sponsorship_confidence: number
  logo_url: string | null
}

type CompanyTarget = {
  id: string
  name: string
  domain: string
  careers_url: string
  ats_type: string | null
  ats_identifier: string | null
  last_crawled_at: string | null
  crawl_allowed: boolean
}

type CrawlResult = {
  company_id: string
  company_name: string
  domain: string
  careers_url: string
  ats_type: string | null
  status: "ok" | "error"
  found_jobs: number
  inserted: number
  updated: number
  active_count: number
  outcome_status: string | null
  outcome_reason: string | null
  error: string | null
}

type ImmigrationLinkResult = {
  company_id: string
  company_name: string
  normalized_key: string
  lca_records_linked: number
  lca_stats_linked: number
  h1b_records_linked: number
  skipped_reason: string | null
}

const SOFTWARE_INDUSTRIES = new Set([
  "technology",
  "artificial intelligence",
])

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
}

function toSeedRow(tuple: SeedTuple): SeedRow {
  const extra: SeedExtra = tuple.length > 5 ? (tuple[5] as SeedExtra) : {}
  const domain = normalizeDomain(tuple[1])
  const careersUrl = tuple[2]
  const detected = detectAtsFromUrl(careersUrl)
  const sponsors = extra.sponsors_h1b ?? false
  const confidence =
    typeof extra.sponsorship_confidence === "number"
      ? extra.sponsorship_confidence
      : sponsors
      ? 65
      : 35

  return {
    name: tuple[0],
    domain,
    careers_url: careersUrl,
    industry: tuple[3],
    size: tuple[4],
    ats_type: extra.ats_type ?? detected?.atsType ?? "custom",
    ats_identifier: extra.ats_identifier ?? detected?.atsIdentifier ?? null,
    sponsors_h1b: sponsors,
    sponsorship_confidence: confidence,
    logo_url: companyLogoUrlFromDomain(domain, "google-favicon"),
  }
}

function shouldIncludeSoftware(row: SeedRow): boolean {
  const industry = row.industry.trim().toLowerCase()
  return SOFTWARE_INDUSTRIES.has(industry)
}

function combineSoftwareSeeds(): SeedRow[] {
  const merged = new Map<string, SeedRow>()
  const all = [...COMPANY_SEED_ROWS, ...EXPANSION_SEED_ROWS] as SeedTuple[]
  for (const tuple of all) {
    const row = toSeedRow(tuple)
    if (!shouldIncludeSoftware(row)) continue
    merged.set(row.domain, row)
  }
  return [...merged.values()].sort((a, b) => a.domain.localeCompare(b.domain))
}

function writeReport(payload: unknown): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2))
  console.log(`[software-seed] report: ${reportPath}`)
}

async function upsertSeeds(
  pool: Pool,
  seeds: SeedRow[]
): Promise<{
  changed: Array<{ id: string; domain: string; name: string; action: "insert" | "update" }>
  inserted: number
  updated: number
}> {
  const changed: Array<{ id: string; domain: string; name: string; action: "insert" | "update" }> =
    []
  let inserted = 0
  let updated = 0

  const upsertSql = `
    INSERT INTO companies (
      name,
      domain,
      careers_url,
      logo_url,
      industry,
      size,
      ats_type,
      ats_identifier,
      is_active,
      sponsors_h1b,
      sponsorship_confidence,
      raw_ats_config,
      last_crawled_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      true, $9, $10, $11::jsonb, NULL
    )
    ON CONFLICT (domain) DO UPDATE SET
      name = EXCLUDED.name,
      careers_url = CASE
        WHEN companies.careers_url IS NULL
          OR btrim(companies.careers_url) = ''
          OR companies.careers_url ILIKE '%linkedin.com%'
        THEN EXCLUDED.careers_url
        ELSE companies.careers_url
      END,
      logo_url = COALESCE(companies.logo_url, EXCLUDED.logo_url),
      industry = COALESCE(companies.industry, EXCLUDED.industry),
      size = COALESCE(companies.size, EXCLUDED.size),
      ats_type = COALESCE(NULLIF(companies.ats_type, ''), EXCLUDED.ats_type),
      ats_identifier = COALESCE(NULLIF(companies.ats_identifier, ''), EXCLUDED.ats_identifier),
      is_active = true,
      last_crawled_at = CASE
        WHEN COALESCE(companies.is_active, false) = false THEN NULL
        ELSE companies.last_crawled_at
      END,
      sponsors_h1b = COALESCE(companies.sponsors_h1b, EXCLUDED.sponsors_h1b),
      sponsorship_confidence = GREATEST(
        COALESCE(companies.sponsorship_confidence, 0),
        COALESCE(EXCLUDED.sponsorship_confidence, 0)
      ),
      raw_ats_config = COALESCE(companies.raw_ats_config, '{}'::jsonb) || EXCLUDED.raw_ats_config,
      updated_at = NOW()
    RETURNING id, name, domain, (xmax = 0) AS was_inserted
  `

  const nowIso = new Date().toISOString()
  for (const seed of seeds) {
    const rawAtsConfig = JSON.stringify({
      source: "software_seed_pipeline",
      guessed_domain: seed.domain,
      domain_verified: true,
      ats_discovery_status: "checked",
      software_seed: {
        synced_at: nowIso,
        seed_name: seed.name,
        seed_domain: seed.domain,
        seed_careers_url: seed.careers_url,
      },
    })

    const { rows } = await pool.query<{
      id: string
      name: string
      domain: string
      was_inserted: boolean
    }>(upsertSql, [
      seed.name,
      seed.domain,
      seed.careers_url,
      seed.logo_url,
      seed.industry,
      seed.size,
      seed.ats_type,
      seed.ats_identifier,
      seed.sponsors_h1b,
      seed.sponsorship_confidence,
      rawAtsConfig,
    ])

    const result = rows[0]
    if (!result) continue
    if (result.was_inserted) inserted += 1
    else updated += 1
    changed.push({
      id: result.id,
      domain: result.domain,
      name: result.name,
      action: result.was_inserted ? "insert" : "update",
    })
  }

  return { changed, inserted, updated }
}

async function loadTargets(pool: Pool, domains: string[]): Promise<CompanyTarget[]> {
  const { rows } = await pool.query<CompanyTarget>(
    `SELECT
       id,
       name,
       lower(domain) AS domain,
       careers_url,
       ats_type,
       ats_identifier,
       last_crawled_at,
       COALESCE((raw_ats_config->>'crawl_allowed')::boolean, true) AS crawl_allowed
     FROM companies
     WHERE lower(domain) = ANY($1::text[])
       AND is_active = true
       AND careers_url IS NOT NULL
       AND btrim(careers_url) <> ''
     ORDER BY domain`,
    [domains]
  )
  return rows
}

async function crawlTargets(
  pool: Pool,
  targets: CompanyTarget[],
  crawlConcurrency: number
): Promise<CrawlResult[]> {
  const limiter = pLimit(crawlConcurrency)
  const results: CrawlResult[] = []

  await Promise.all(
    targets.map((company) =>
      limiter(async () => {
        process.stdout.write(`\n[software-seed] crawling ${company.domain} ... `)
        try {
          const crawl = await crawlCareersPage({
            id: company.id,
            companyName: company.name,
            careersUrl: company.careers_url,
            lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
            atsType: company.ats_type,
            atsIdentifier: company.ats_identifier,
            domain: company.domain,
          })

          const persisted = await persistCrawlJobs({
            companyId: company.id,
            crawledAt: crawl.crawledAt,
            jobs: crawl.jobs,
            sourceUrl: crawl.url,
            normalizedUrl: crawl.normalizedUrl,
            diagnostics: crawl.diagnostics,
          })

          process.stdout.write(
            `ok found=${crawl.jobs.length} inserted=${persisted.inserted} updated=${persisted.updated} active=${persisted.activeCount}`
          )

          results.push({
            company_id: company.id,
            company_name: company.name,
            domain: company.domain,
            careers_url: company.careers_url,
            ats_type: company.ats_type,
            status: "ok",
            found_jobs: crawl.jobs.length,
            inserted: persisted.inserted,
            updated: persisted.updated,
            active_count: persisted.activeCount,
            outcome_status: crawl.outcomeStatus ?? (crawl.jobs.length > 0 ? "success" : "empty"),
            outcome_reason:
              crawl.outcomeReason ?? (crawl.jobs.length > 0 ? "success" : "empty_job_list"),
            error: null,
          })
        } catch (error) {
          const message = sanitizeError(error)
          process.stdout.write(`error ${message}`)
          results.push({
            company_id: company.id,
            company_name: company.name,
            domain: company.domain,
            careers_url: company.careers_url,
            ats_type: company.ats_type,
            status: "error",
            found_jobs: 0,
            inserted: 0,
            updated: 0,
            active_count: 0,
            outcome_status: "error",
            outcome_reason: "crawl_exception",
            error: message,
          })
        }
      })
    )
  )

  return results
}

async function linkImmigrationForJobfulCompanies(
  pool: Pool,
  companyIds: string[]
): Promise<ImmigrationLinkResult[]> {
  if (companyIds.length === 0) return []

  const { rows: companies } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM companies WHERE id = ANY($1::uuid[])`,
    [companyIds]
  )
  if (companies.length === 0) return []

  const { rows: allCompanies } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM companies`
  )
  const byNormalized = new Map<string, string[]>()
  for (const row of allCompanies) {
    const key = normalizeEmployerName(row.name)
    if (!key) continue
    byNormalized.set(key, [...(byNormalized.get(key) ?? []), row.id])
  }

  const { rows: unmatchedH1B } = await pool.query<{ employer_name: string }>(
    `SELECT employer_name
     FROM h1b_records
     WHERE company_id IS NULL
       AND employer_name IS NOT NULL
     GROUP BY employer_name`
  )
  const unmatchedH1BByNormalized = new Map<string, string[]>()
  for (const row of unmatchedH1B) {
    const key = normalizeEmployerName(row.employer_name)
    if (!key) continue
    unmatchedH1BByNormalized.set(key, [...(unmatchedH1BByNormalized.get(key) ?? []), row.employer_name])
  }

  const linkResults: ImmigrationLinkResult[] = []
  for (const company of companies) {
    const normalizedKey = normalizeEmployerName(company.name)
    if (!normalizedKey) {
      linkResults.push({
        company_id: company.id,
        company_name: company.name,
        normalized_key: "",
        lca_records_linked: 0,
        lca_stats_linked: 0,
        h1b_records_linked: 0,
        skipped_reason: "empty_normalized_key",
      })
      continue
    }

    const normalizedMatches = byNormalized.get(normalizedKey) ?? []
    if (normalizedMatches.length !== 1 || normalizedMatches[0] !== company.id) {
      linkResults.push({
        company_id: company.id,
        company_name: company.name,
        normalized_key: normalizedKey,
        lca_records_linked: 0,
        lca_stats_linked: 0,
        h1b_records_linked: 0,
        skipped_reason: "ambiguous_company_normalized_key",
      })
      continue
    }

    const lcaRecordsRes = await pool.query(
      `UPDATE lca_records
       SET company_id = $1
       WHERE company_id IS NULL
         AND employer_name_normalized = $2`,
      [company.id, normalizedKey]
    )

    const lcaStatsRes = await pool.query(
      `UPDATE employer_lca_stats
       SET company_id = $1
       WHERE company_id IS NULL
         AND employer_name_normalized = $2`,
      [company.id, normalizedKey]
    )

    let h1bLinked = 0
    const employerNames = unmatchedH1BByNormalized.get(normalizedKey) ?? []
    for (const employerName of employerNames) {
      const h1bRes = await pool.query(
        `UPDATE h1b_records
         SET company_id = $1
         WHERE company_id IS NULL
           AND employer_name = $2`,
        [company.id, employerName]
      )
      h1bLinked += h1bRes.rowCount ?? 0
    }

    linkResults.push({
      company_id: company.id,
      company_name: company.name,
      normalized_key: normalizedKey,
      lca_records_linked: lcaRecordsRes.rowCount ?? 0,
      lca_stats_linked: lcaStatsRes.rowCount ?? 0,
      h1b_records_linked: h1bLinked,
      skipped_reason: null,
    })
  }

  return linkResults
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL (or TARGET_POSTGRES_URL)")

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  })

  const seedsAll = combineSoftwareSeeds()
  const seeds = limit ? seedsAll.slice(0, limit) : seedsAll

  console.log(
    `[software-seed] mode=${execute ? "EXECUTE" : "dry-run"} seeds=${seeds.length}/${seedsAll.length} concurrency=${concurrency}`
  )

  const report: {
    mode: "dry-run" | "execute"
    generated_at: string
    summary: Record<string, number | string>
    preview?: Array<Record<string, unknown>>
    upsert?: Array<Record<string, unknown>>
    crawl_results?: CrawlResult[]
    immigration_links?: ImmigrationLinkResult[]
  } = {
    mode: execute ? "execute" : "dry-run",
    generated_at: new Date().toISOString(),
    summary: {
      seeds_total: seedsAll.length,
      seeds_selected: seeds.length,
    },
  }

  if (!execute) {
    report.preview = seeds.slice(0, 25).map((seed) => ({
      domain: seed.domain,
      name: seed.name,
      industry: seed.industry,
      careers_url: seed.careers_url,
      ats_type: seed.ats_type,
      ats_identifier: seed.ats_identifier,
    }))
    writeReport(report)
    console.log("[software-seed] dry-run complete")
    await pool.end()
    return
  }

  try {
    const upsert = await upsertSeeds(pool, seeds)
    console.log(`[software-seed] upsert inserted=${upsert.inserted} updated=${upsert.updated}`)

    const targetDomains = seeds.map((seed) => seed.domain)
    const allTargets = await loadTargets(pool, targetDomains)
    const blocked = allTargets.filter((row) => !row.crawl_allowed)
    const allowed = allTargets.filter((row) => row.crawl_allowed)
    console.log(
      `[software-seed] targets total=${allTargets.length} allowed=${allowed.length} blocked=${blocked.length}`
    )

    const crawlResults = await crawlTargets(pool, allowed, concurrency)
    const ok = crawlResults.filter((row) => row.status === "ok")
    const failed = crawlResults.filter((row) => row.status === "error")
    const jobful = ok.filter((row) => row.found_jobs > 0)
    const empty = ok.filter((row) => row.found_jobs === 0)

    console.log(`\n[software-seed] crawl completed ok=${ok.length} failed=${failed.length}`)
    console.log(`[software-seed] jobful=${jobful.length} empty=${empty.length}`)

    const jobfulCompanyIds = [...new Set(jobful.map((row) => row.company_id))]
    const immigrationLinks = await linkImmigrationForJobfulCompanies(pool, jobfulCompanyIds)
    const linkedH1B = immigrationLinks.reduce((sum, row) => sum + row.h1b_records_linked, 0)
    const linkedLCA = immigrationLinks.reduce((sum, row) => sum + row.lca_records_linked, 0)
    const linkedLCAStats = immigrationLinks.reduce((sum, row) => sum + row.lca_stats_linked, 0)

    console.log(
      `[software-seed] immigration links h1b=${linkedH1B} lca_records=${linkedLCA} lca_stats=${linkedLCAStats}`
    )

    report.summary = {
      ...report.summary,
      upsert_inserted: upsert.inserted,
      upsert_updated: upsert.updated,
      crawl_targets_total: allTargets.length,
      crawl_targets_allowed: allowed.length,
      crawl_targets_blocked: blocked.length,
      crawl_ok: ok.length,
      crawl_failed: failed.length,
      crawl_jobful: jobful.length,
      crawl_empty: empty.length,
      immigration_companies_considered: jobfulCompanyIds.length,
      immigration_h1b_linked_rows: linkedH1B,
      immigration_lca_linked_rows: linkedLCA,
      immigration_lca_stats_linked_rows: linkedLCAStats,
      uncaught_exceptions: uncaughtExceptionCount,
      unhandled_rejections: unhandledRejectionCount,
    }
    report.upsert = upsert.changed
    report.crawl_results = crawlResults.sort((a, b) => a.domain.localeCompare(b.domain))
    report.immigration_links = immigrationLinks.sort((a, b) =>
      a.company_name.localeCompare(b.company_name)
    )

    writeReport(report)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[software-seed] failed", error)
  process.exit(1)
})
