/**
 * GET /api/cron/jsearch-ingest
 *
 * Pulls fresh jobs from JSearch (RapidAPI) which aggregates LinkedIn, Indeed,
 * Glassdoor, and ZipRecruiter — the boards that block direct scraping.
 *
 * Key advantage over Dice/Adzuna: JSearch returns the employer's real website
 * domain, so new companies get proper domain rows (not name-slug placeholders)
 * and their ATS gets detected on the very next discover-tenants run.
 *
 * API budget planning (requests = pages, 10 results/page):
 *   Free  200 req/mo → 6 req/day  → 6 queries × 1 page  (run daily)
 *   $10   500 req/mo → 16 req/day → 8 queries × 2 pages (run daily)
 *   $30  1500 req/mo → 50 req/day → 10 queries × 5 pages (run daily)
 *
 * Env:
 *   JSEARCH_API_KEY          — required (RapidAPI key)
 *   JSEARCH_SEARCH_QUERIES   — comma-separated keywords (default list below)
 *   JSEARCH_DATE_POSTED      — today | 3days | week (default: today)
 *   JSEARCH_PAGES_PER_QUERY  — pages per query (default: 1)
 *   JSEARCH_MAX_QUERIES      — max queries per run (default: 6)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { bumpHarvestForActiveCompanies } from "@/lib/harvester/freshness-signal"
import { enrollFromApplyUrl } from "@/lib/harvester/discovery/enroll-from-apply-url"
import {
  searchJSearchAllPages,
  type JSearchJob,
} from "@/lib/sources/jsearch"

export const runtime = "nodejs"
export const maxDuration = 300

const DEFAULT_QUERIES = [
  "software engineer",
  "frontend developer",
  "backend developer",
  "full stack developer",
  "data engineer",
  "machine learning engineer",
  "devops engineer",
  "cloud engineer",
  "product manager",
  "data scientist",
]

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const queryOverride = url.searchParams.get("q")
  const maxQueries = Number(url.searchParams.get("maxQueries") ?? process.env.JSEARCH_MAX_QUERIES ?? "6")
  const pagesPerQuery = Number(url.searchParams.get("pages") ?? process.env.JSEARCH_PAGES_PER_QUERY ?? "1")
  const datePosted = (url.searchParams.get("datePosted") ?? process.env.JSEARCH_DATE_POSTED ?? "today") as "today" | "3days" | "week"

  const queries = queryOverride
    ? [queryOverride]
    : (process.env.JSEARCH_SEARCH_QUERIES ?? "")
        .split(",")
        .map((q) => q.trim())
        .filter(Boolean)
        .concat(DEFAULT_QUERIES)
        .filter((q, i, arr) => arr.indexOf(q) === i)
        .slice(0, maxQueries)

  const pool = getPostgresPool()
  const stats: Record<string, number> = {
    queries: 0, fetched: 0, inserted: 0, updated: 0, errors: 0, harvestBumped: 0,
  }

  // Dedupe across queries by JSearch job ID
  const seen = new Map<string, JSearchJob>()

  for (const q of queries) {
    try {
      const jobs = await searchJSearchAllPages({ query: q, datePosted }, pagesPerQuery)
      stats.queries++
      for (const job of jobs) {
        if (!seen.has(job.id)) seen.set(job.id, job)
      }
      stats.fetched = seen.size
    } catch (err) {
      console.error(`[jsearch-ingest] query "${q}" failed:`, err)
      stats.errors++
    }
  }

  if (seen.size === 0) {
    return NextResponse.json({ ...stats, message: "No jobs fetched" })
  }

  // Group by normalized company name for batch resolution
  const byCompany = new Map<string, JSearchJob[]>()
  for (const job of seen.values()) {
    const key = job.company.toLowerCase().trim()
    if (!byCompany.has(key)) byCompany.set(key, [])
    byCompany.get(key)!.push(job)
  }

  // Bulk lookup existing companies by name
  const companyNames = [...byCompany.keys()]
  const companyIdMap = new Map<string, string>()

  const existingResult = await pool.query<{ id: string; name: string }>(
    `SELECT id, LOWER(TRIM(name)) AS name
     FROM companies
     WHERE LOWER(TRIM(name)) = ANY($1)`,
    [companyNames]
  )
  for (const row of existingResult.rows) {
    companyIdMap.set(row.name, row.id)
  }

  // Create companies for unknowns.
  // JSearch returns real apply URLs — try ATS detection first to create a
  // harvestable row immediately. Fall back to domain-based placeholder.
  const missing = companyNames.filter((n) => !companyIdMap.has(n))
  for (const normName of missing) {
    const sample = byCompany.get(normName)![0]
    const domain = sample.companyDomain ?? deriveFallbackDomain(sample.company)
    try {
      // Try ATS detection from the direct apply URL
      if (sample.applyUrl) {
        const enrolled = await enrollFromApplyUrl(pool, {
          companyName: sample.company,
          applyUrl: sample.applyUrl,
          companyDomain: sample.companyDomain,
          logoUrl: sample.companyLogo,
          source: "jsearch",
        })
        if (enrolled) {
          companyIdMap.set(normName, enrolled.id)
          continue
        }
      }
      const res = await pool.query<{ id: string }>(
        `INSERT INTO companies (name, domain, careers_url, is_active, logo_url, raw_ats_config)
         VALUES ($1, $2, $3, false, $4, $5)
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          sample.company,
          domain,
          sample.companyDomain ? `https://${sample.companyDomain}` : null,
          sample.companyLogo ?? null,
          JSON.stringify({ source: "jsearch", publisher: sample.publisher, crawl_allowed: false }),
        ]
      )
      if (res.rows[0]) companyIdMap.set(normName, res.rows[0].id)
    } catch {
      // Domain conflict — skip
    }
  }

  // Bulk-check existing job external_ids
  const allExternalIds = [...seen.values()].map((j) => `jsearch:${j.id}`)
  const existingRows = await pool.query<{ id: string; external_id: string }>(
    `SELECT id, external_id FROM jobs WHERE external_id = ANY($1)`,
    [allExternalIds]
  )
  const existingByExtId = new Map(existingRows.rows.map((r) => [r.external_id, r.id]))

  // Upsert jobs
  for (const job of seen.values()) {
    if (!job.applyUrl) continue
    const companyId = companyIdMap.get(job.company.toLowerCase().trim())
    if (!companyId) continue

    const externalId = `jsearch:${job.id}`
    const firstDetected = new Date(job.postedAt).toISOString()
    const rawData = JSON.stringify({ source: "jsearch", publisher: job.publisher, applyIsDirect: job.applyIsDirect })
    const existingId = existingByExtId.get(externalId)

    try {
      if (existingId) {
        await pool.query(
          `UPDATE jobs SET
             title=$1, location=$2, is_remote=$3,
             employment_type=$4, description=$5,
             salary_min=$6, salary_max=$7,
             salary_currency=$8, is_active=true,
             last_seen_at=NOW(), updated_at=NOW(), raw_data=$9
           WHERE id=$10`,
          [job.title, job.location, job.isRemote, job.employmentType ?? null,
           job.description || null, job.salaryMin ?? null, job.salaryMax ?? null,
           job.salaryCurrency ?? "USD", rawData, existingId]
        )
        stats.updated++
      } else {
        await pool.query(
          `INSERT INTO jobs (
             company_id, title, location, is_remote,
             employment_type, description, apply_url, external_id,
             salary_min, salary_max, salary_currency,
             is_active, last_seen_at, first_detected_at,
             created_at, updated_at, raw_data
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             true, NOW(), $12, NOW(), NOW(), $13
           )`,
          [companyId, job.title, job.location, job.isRemote,
           job.employmentType ?? null, job.description || null,
           job.applyUrl, externalId,
           job.salaryMin ?? null, job.salaryMax ?? null,
           job.salaryCurrency ?? "USD",
           firstDetected, rawData]
        )
        stats.inserted++
      }
    } catch (err) {
      console.error(`[jsearch-ingest] failed to upsert job ${job.id}:`, err)
      stats.errors++
    }
  }

  // Refresh job_count on touched companies
  await pool.query(
    `UPDATE companies c
     SET job_count = (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.is_active = true)
     WHERE c.id = ANY($1)`,
    [[...companyIdMap.values()]]
  )

  // Bump known ATS companies forward — actively hiring signal
  try {
    stats.harvestBumped = await bumpHarvestForActiveCompanies(pool, [...companyIdMap.values()])
  } catch (err) {
    console.error("[jsearch-ingest] harvest bump failed:", err)
  }

  return NextResponse.json({ ok: true, ...stats })
}

function deriveFallbackDomain(companyName: string): string {
  return `jsearch-${companyName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40)}.placeholder`
}
