/**
 * Crawl state-linked employers with multi-industry balancing and relink
 * unmatched H1B/LCA rows to successful company matches.
 *
 * Goals:
 * - Focus on companies with LCA footprint in the target state.
 * - Avoid software-only selection by balancing picks across industries.
 * - Crawl careers pages and persist jobs.
 * - Keep successful companies active.
 * - Relink unmatched LCA/H1B rows to those successful companies using
 *   deterministic normalization (no fuzzy matching).
 *
 * Usage:
 *   npx tsx scripts/crawl-texas-multi-industry.ts
 *   npx tsx scripts/crawl-texas-multi-industry.ts --execute
 *   npx tsx scripts/crawl-texas-multi-industry.ts --execute --limit=30 --concurrency=6
 *   npx tsx scripts/crawl-texas-multi-industry.ts --execute --state=CA
 *   npx tsx scripts/crawl-texas-multi-industry.ts --execute --exclude-technology
 */

import fs from "node:fs"
import path from "node:path"
import pLimit from "p-limit"
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

loadEnvConfig(process.cwd())

// Node 20 + undici occasionally emits this even when callers handled fetch
// errors correctly. Ignore only this known false-positive.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (msg.includes("Controller is already closed")) return
  console.error("[state-crawl] unhandledRejection:", reason)
  process.exit(1)
})

process.on("uncaughtException", (error) => {
  const msg = error instanceof Error ? error.message : String(error)
  if (msg.includes("Controller is already closed")) return
  console.error("[state-crawl] uncaughtException:", error)
  process.exit(1)
})

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500)
  return String(error).slice(0, 500)
}

const LEGAL_SUFFIXES = new Set([
  "INC",
  "INCORPORATED",
  "LLC",
  "L.L.C",
  "LTD",
  "LIMITED",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "PLC",
  "LLP",
  "LP",
  "HOLDINGS",
  "HOLDING",
  "GROUP",
  "SERVICES",
  "SOLUTIONS",
])

function normalizeEmployerName(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !LEGAL_SUFFIXES.has(token))
    .join(" ")
    .trim()
}

function isPlaceholderDomain(domain: string | null): boolean {
  if (!domain) return false
  const d = domain.toLowerCase().trim()
  return d.endsWith(".lca-employer") || d.endsWith(".uscis-employer")
}

function normalizeIndustry(raw: string | null): string {
  const value = (raw ?? "").trim()
  if (!value) return "Unknown"
  const lower = value.toLowerCase()
  if (
    lower.includes("tech") ||
    lower.includes("software") ||
    lower.includes("ai") ||
    lower.includes("cyber")
  ) {
    return "Technology"
  }
  if (lower.includes("finance") || lower.includes("bank")) return "Finance"
  if (lower.includes("health")) return "Healthcare"
  if (lower.includes("retail") || lower.includes("commerce")) return "Retail"
  if (lower.includes("education")) return "Education"
  if (lower.includes("hospitality") || lower.includes("travel")) {
    return "Travel & Hospitality"
  }
  return value
}

const execute = process.argv.includes("--execute")
const includeTechnology = !process.argv.includes("--exclude-technology")
const limit = Math.max(1, Number(flag("limit")) || 24)
const concurrency = Math.max(1, Number(flag("concurrency")) || 6)
const perIndustryCap = Math.max(1, Number(flag("per-industry-cap")) || 8)
const rawState = (flag("state") ?? "TX").trim().toUpperCase()
if (!/^[A-Z]{2}$/.test(rawState)) {
  throw new Error(`Invalid --state value: "${rawState}". Expected 2-letter state code.`)
}
const stateAbbr = rawState
const minStateCertified = Math.max(
  1,
  Number(flag("min-state-certified") ?? flag("min-tx-certified")) || 10
)
const runStamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19)
const reportPath =
  flag("report") ||
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `${stateAbbr.toLowerCase()}-multi-industry-crawl-${runStamp}-${execute ? "execute" : "dry-run"}.json`
  )

type CandidateRow = {
  id: string
  name: string
  industry: string | null
  domain: string
  careers_url: string
  ats_type: string | null
  ats_identifier: string | null
  is_active: boolean
  last_crawled_at: string | null
  job_count: number
  tx_lca_rows: number
  tx_certified: number
  latest_fy: number | null
  h1b_approved: number
  h1b_denied: number
  latest_h1b_year: number | null
}

type SelectedRow = CandidateRow & {
  industry_bucket: string
  selection_score: number
}

type CrawlRow = {
  company_id: string
  company_name: string
  industry: string
  domain: string
  careers_url: string
  ats_type: string | null
  status: "ok" | "error"
  found_jobs: number
  inserted: number
  updated: number
  active_count: number
  linked_lca_rows: number
  linked_lca_stats_rows: number
  linked_h1b_rows: number
  error: string | null
}

type LinkKeyMeta = {
  companyId: string
  companyName: string
  keys: Set<string>
}

function writeReport(payload: unknown): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2))
  console.log(`[state-crawl] report: ${reportPath}`)
}

function computeSelectionScore(row: CandidateRow): number {
  return row.tx_certified * 3 + row.tx_lca_rows + row.h1b_approved
}

function chooseBalancedCandidates(
  rows: CandidateRow[],
  opts: { limit: number; perIndustryCap: number; includeTechnology: boolean }
): SelectedRow[] {
  const seeded = rows
    .map((row) => {
      const industryBucket = normalizeIndustry(row.industry)
      return {
        ...row,
        industry_bucket: industryBucket,
        selection_score: computeSelectionScore(row),
      }
    })
    .filter((row) => opts.includeTechnology || row.industry_bucket !== "Technology")
    .sort((a, b) => b.selection_score - a.selection_score)

  const byIndustry = new Map<string, SelectedRow[]>()
  for (const row of seeded) {
    const bucket = byIndustry.get(row.industry_bucket) ?? []
    bucket.push(row)
    byIndustry.set(row.industry_bucket, bucket)
  }

  const nonTechIndustries = Array.from(byIndustry.keys())
    .filter((i) => i !== "Technology")
    .sort((a, b) => {
      const aTop = byIndustry.get(a)?.[0]?.selection_score ?? 0
      const bTop = byIndustry.get(b)?.[0]?.selection_score ?? 0
      return bTop - aTop
    })
  const techIndustries = Array.from(byIndustry.keys()).filter((i) => i === "Technology")
  const laneOrder = [...nonTechIndustries, ...techIndustries]

  const selected: SelectedRow[] = []
  const seen = new Set<string>()
  const industryCounts = new Map<string, number>()

  while (selected.length < opts.limit) {
    let pickedThisRound = false
    for (const lane of laneOrder) {
      if (selected.length >= opts.limit) break
      const count = industryCounts.get(lane) ?? 0
      if (count >= opts.perIndustryCap) continue
      const queue = byIndustry.get(lane) ?? []
      while (queue.length > 0 && seen.has(queue[0]!.id)) queue.shift()
      const next = queue.shift()
      if (!next) continue
      selected.push(next)
      seen.add(next.id)
      industryCounts.set(lane, count + 1)
      pickedThisRound = true
    }
    if (!pickedThisRound) break
  }

  return selected
}

async function loadCandidates(pool: Pool): Promise<CandidateRow[]> {
  const { rows } = await pool.query<CandidateRow>(
    `WITH tx AS (
       SELECT
         l.company_id,
         COUNT(*)::int AS tx_lca_rows,
         COUNT(*) FILTER (WHERE COALESCE(l.case_status, '') ILIKE 'certified%')::int AS tx_certified,
         MAX(l.fiscal_year) AS latest_fy
       FROM lca_records l
       WHERE l.company_id IS NOT NULL
         AND l.worksite_state_abbr = $1
       GROUP BY l.company_id
     ),
     h AS (
       SELECT
         company_id,
         SUM(COALESCE(approved, 0))::int AS h1b_approved,
         SUM(COALESCE(denied, 0))::int AS h1b_denied,
         MAX(year) AS latest_h1b_year
       FROM h1b_records
       WHERE company_id IS NOT NULL
       GROUP BY company_id
     )
     SELECT
       c.id,
       c.name,
       c.industry,
       c.domain,
       c.careers_url,
       c.ats_type,
       c.ats_identifier,
       c.is_active,
       c.last_crawled_at,
       COALESCE(c.job_count, 0)::int AS job_count,
       tx.tx_lca_rows,
       tx.tx_certified,
       tx.latest_fy,
       COALESCE(h.h1b_approved, 0)::int AS h1b_approved,
       COALESCE(h.h1b_denied, 0)::int AS h1b_denied,
       h.latest_h1b_year
     FROM tx
     JOIN companies c ON c.id = tx.company_id
     LEFT JOIN h ON h.company_id = c.id
     WHERE c.careers_url IS NOT NULL
       AND btrim(c.careers_url) <> ''
       AND c.careers_url NOT ILIKE '%linkedin.com/jobs/search%'
       AND c.domain IS NOT NULL
       AND c.domain <> ''
       AND c.domain NOT LIKE '%.lca-employer'
       AND c.domain NOT LIKE '%.uscis-employer'
       AND tx.tx_certified >= $2
     ORDER BY tx.tx_certified DESC, tx.tx_lca_rows DESC`,
    [stateAbbr, minStateCertified]
  )
  return rows.filter((row) => !isPlaceholderDomain(row.domain))
}

async function buildLinkKeyMeta(
  pool: Pool,
  selected: SelectedRow[]
): Promise<Map<string, LinkKeyMeta>> {
  const companyIds = selected.map((row) => row.id)
  const out = new Map<string, LinkKeyMeta>()
  for (const row of selected) {
    const key = normalizeEmployerName(row.name)
    out.set(row.id, {
      companyId: row.id,
      companyName: row.name,
      keys: key ? new Set([key]) : new Set<string>(),
    })
  }

  const linkedLca = await pool.query<{
    company_id: string
    employer_name_normalized: string | null
  }>(
    `SELECT company_id, employer_name_normalized
     FROM lca_records
     WHERE company_id = ANY($1::uuid[])
       AND employer_name_normalized IS NOT NULL
     GROUP BY company_id, employer_name_normalized`,
    [companyIds]
  )
  for (const row of linkedLca.rows) {
    const meta = out.get(row.company_id)
    const key = row.employer_name_normalized?.trim().toUpperCase()
    if (!meta || !key) continue
    meta.keys.add(key)
  }

  const linkedStats = await pool.query<{
    company_id: string
    employer_name_normalized: string | null
  }>(
    `SELECT company_id, employer_name_normalized
     FROM employer_lca_stats
     WHERE company_id = ANY($1::uuid[])
       AND employer_name_normalized IS NOT NULL
     GROUP BY company_id, employer_name_normalized`,
    [companyIds]
  )
  for (const row of linkedStats.rows) {
    const meta = out.get(row.company_id)
    const key = row.employer_name_normalized?.trim().toUpperCase()
    if (!meta || !key) continue
    meta.keys.add(key)
  }

  return out
}

async function relinkForCompany(
  pool: Pool,
  companyId: string,
  companyKeys: Set<string>,
  h1bExactEmployerNames: string[]
): Promise<{
  linkedLcaRows: number
  linkedLcaStatsRows: number
  linkedH1bRows: number
}> {
  const keys = Array.from(companyKeys).filter((key) => key.length >= 3)
  let linkedLcaRows = 0
  let linkedLcaStatsRows = 0
  let linkedH1bRows = 0

  if (keys.length > 0) {
    const lcaRes = await pool.query(
      `UPDATE lca_records
       SET company_id = $1
       WHERE company_id IS NULL
         AND employer_name_normalized = ANY($2::text[])`,
      [companyId, keys]
    )
    linkedLcaRows += lcaRes.rowCount ?? 0

    const statsRes = await pool.query(
      `UPDATE employer_lca_stats
       SET company_id = $1
       WHERE company_id IS NULL
         AND employer_name_normalized = ANY($2::text[])`,
      [companyId, keys]
    )
    linkedLcaStatsRows += statsRes.rowCount ?? 0
  }

  const names = Array.from(new Set(h1bExactEmployerNames))
  const H1B_CHUNK = 100
  for (let i = 0; i < names.length; i += H1B_CHUNK) {
    const chunk = names.slice(i, i + H1B_CHUNK)
    const h1bRes = await pool.query(
      `UPDATE h1b_records
       SET company_id = $1
       WHERE company_id IS NULL
         AND employer_name = ANY($2::text[])`,
      [companyId, chunk]
    )
    linkedH1bRows += h1bRes.rowCount ?? 0
  }

  return { linkedLcaRows, linkedLcaStatsRows, linkedH1bRows }
}

async function loadUnmatchedH1BEmployers(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ employer_name: string }>(
    `SELECT employer_name
     FROM h1b_records
     WHERE company_id IS NULL
       AND employer_name IS NOT NULL
     GROUP BY employer_name`
  )
  return rows.map((row) => row.employer_name).filter(Boolean)
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL (or TARGET_POSTGRES_URL)")
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const runTag = `[state-crawl:${stateAbbr}]`
    console.log(
      `${runTag} mode=${execute ? "EXECUTE" : "dry-run"} limit=${limit} concurrency=${concurrency} perIndustryCap=${perIndustryCap} includeTechnology=${includeTechnology} minStateCertified=${minStateCertified}`
    )

    const candidates = await loadCandidates(pool)
    const selected = chooseBalancedCandidates(candidates, {
      limit,
      perIndustryCap,
      includeTechnology,
    })

    const selectedIndustryCounts = new Map<string, number>()
    for (const row of selected) {
      selectedIndustryCounts.set(
        row.industry_bucket,
        (selectedIndustryCounts.get(row.industry_bucket) ?? 0) + 1
      )
    }

    console.log(
      `${runTag} candidates=${candidates.length} selected=${selected.length} industries=${selectedIndustryCounts.size}`
    )
    console.table(
      Array.from(selectedIndustryCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([industry, count]) => ({ industry, count }))
    )

    if (!execute) {
      console.table(
        selected.map((row) => ({
          industry: row.industry_bucket,
          company: row.name,
          domain: row.domain,
          ats: row.ats_type ?? "null",
          state_certified: row.tx_certified,
          h1b_approved: row.h1b_approved,
          job_count: row.job_count,
          careers_url: row.careers_url,
        }))
      )
      writeReport({
        mode: "dry-run",
        generated_at: new Date().toISOString(),
        config: {
          state: stateAbbr,
          limit,
          concurrency,
          per_industry_cap: perIndustryCap,
          include_technology: includeTechnology,
          min_state_certified: minStateCertified,
        },
        summary: {
          candidates: candidates.length,
          selected: selected.length,
          selected_industry_counts: Object.fromEntries(selectedIndustryCounts),
        },
        selected,
      })
      return
    }

    const linkMetaByCompany = await buildLinkKeyMeta(pool, selected)
    const unmatchedH1bEmployers = await loadUnmatchedH1BEmployers(pool)

    // Build a globally-safe owner map from unique normalized company names.
    const allCompanies = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM companies`
    )
    const globalNormOwners = new Map<string, string[]>()
    for (const row of allCompanies.rows) {
      const key = normalizeEmployerName(row.name)
      if (!key) continue
      globalNormOwners.set(key, [...(globalNormOwners.get(key) ?? []), row.id])
    }

    // For each selected company, map unmatched H1B exact employer names whose
    // normalized key is uniquely owned by that company.
    const h1bNamesByCompany = new Map<string, string[]>()
    for (const employerName of unmatchedH1bEmployers) {
      const key = normalizeEmployerName(employerName)
      if (!key) continue
      const owners = globalNormOwners.get(key) ?? []
      if (owners.length !== 1) continue
      const ownerId = owners[0]!
      if (!linkMetaByCompany.has(ownerId)) continue
      const list = h1bNamesByCompany.get(ownerId) ?? []
      list.push(employerName)
      h1bNamesByCompany.set(ownerId, list)
    }

    const limiter = pLimit(concurrency)
    const results: CrawlRow[] = []
    const started = Date.now()

    await Promise.all(
      selected.map((company) =>
        limiter(async () => {
          process.stdout.write(`\n${runTag} crawling ${company.domain} ... `)
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
              resolvedCareersUrl: crawl.resolvedCareersUrl,
            })

            let linkedLcaRows = 0
            let linkedLcaStatsRows = 0
            let linkedH1bRows = 0

            const isSuccessful = persisted.activeCount > 0
            if (isSuccessful) {
              await pool.query(
                `UPDATE companies SET is_active = true, updated_at = NOW() WHERE id = $1`,
                [company.id]
              )
              const keyMeta = linkMetaByCompany.get(company.id)
              const relinked = await relinkForCompany(
                pool,
                company.id,
                keyMeta?.keys ?? new Set<string>(),
                h1bNamesByCompany.get(company.id) ?? []
              )
              linkedLcaRows = relinked.linkedLcaRows
              linkedLcaStatsRows = relinked.linkedLcaStatsRows
              linkedH1bRows = relinked.linkedH1bRows
            }

            process.stdout.write(
              `ok found=${crawl.jobs.length} inserted=${persisted.inserted} updated=${persisted.updated} active=${persisted.activeCount} link(lca=${linkedLcaRows},stats=${linkedLcaStatsRows},h1b=${linkedH1bRows})`
            )

            results.push({
              company_id: company.id,
              company_name: company.name,
              industry: company.industry_bucket,
              domain: company.domain,
              careers_url: company.careers_url,
              ats_type: company.ats_type,
              status: "ok",
              found_jobs: crawl.jobs.length,
              inserted: persisted.inserted,
              updated: persisted.updated,
              active_count: persisted.activeCount,
              linked_lca_rows: linkedLcaRows,
              linked_lca_stats_rows: linkedLcaStatsRows,
              linked_h1b_rows: linkedH1bRows,
              error: null,
            })
          } catch (error) {
            const message = asErrorMessage(error)
            process.stdout.write(`error ${message}`)
            results.push({
              company_id: company.id,
              company_name: company.name,
              industry: company.industry_bucket,
              domain: company.domain,
              careers_url: company.careers_url,
              ats_type: company.ats_type,
              status: "error",
              found_jobs: 0,
              inserted: 0,
              updated: 0,
              active_count: 0,
              linked_lca_rows: 0,
              linked_lca_stats_rows: 0,
              linked_h1b_rows: 0,
              error: message,
            })
          }
        })
      )
    )

    const ok = results.filter((row) => row.status === "ok")
    const failed = results.filter((row) => row.status === "error")
    const successful = results.filter((row) => row.status === "ok" && row.active_count > 0)
    const jobsFound = ok.reduce((sum, row) => sum + row.found_jobs, 0)
    const inserted = ok.reduce((sum, row) => sum + row.inserted, 0)
    const updated = ok.reduce((sum, row) => sum + row.updated, 0)
    const linkedLca = successful.reduce((sum, row) => sum + row.linked_lca_rows, 0)
    const linkedStats = successful.reduce((sum, row) => sum + row.linked_lca_stats_rows, 0)
    const linkedH1b = successful.reduce((sum, row) => sum + row.linked_h1b_rows, 0)

    console.log("\n")
    console.log(
      `${runTag} completed attempted=${results.length} ok=${ok.length} failed=${failed.length} successful=${successful.length}`
    )
    console.log(
      `${runTag} jobs_found=${jobsFound} inserted=${inserted} updated=${updated} linked(lca=${linkedLca},stats=${linkedStats},h1b=${linkedH1b}) elapsed_ms=${Date.now() - started}`
    )

    writeReport({
      mode: "execute",
      generated_at: new Date().toISOString(),
      config: {
        state: stateAbbr,
        limit,
        concurrency,
        per_industry_cap: perIndustryCap,
        include_technology: includeTechnology,
        min_state_certified: minStateCertified,
      },
      summary: {
        candidates: candidates.length,
        selected: selected.length,
        attempted: results.length,
        ok: ok.length,
        failed: failed.length,
        successful: successful.length,
        jobs_found: jobsFound,
        jobs_inserted: inserted,
        jobs_updated: updated,
        linked_lca_rows: linkedLca,
        linked_lca_stats_rows: linkedStats,
        linked_h1b_rows: linkedH1b,
        elapsed_ms: Date.now() - started,
        selected_industry_counts: Object.fromEntries(selectedIndustryCounts),
      },
      failed,
      successful,
      results,
      selected,
    })
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[state-crawl] failed:", error)
  process.exit(1)
})
