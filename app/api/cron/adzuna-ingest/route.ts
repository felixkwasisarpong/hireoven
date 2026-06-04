/**
 * GET /api/cron/adzuna-ingest
 *
 * Pulls fresh jobs from the Adzuna aggregator API (covers LinkedIn, Indeed,
 * company boards) and upserts them into the jobs table. Unlike Dice, Adzuna
 * returns full descriptions in search results so no enrichment step is needed.
 *
 * For each company seen:
 *  - Known ATS companies: harvest is bumped forward (freshness-signal loop).
 *  - Unknown companies: a placeholder row is created so the FK is satisfied;
 *    discover-tenants will resolve their ATS on its next run.
 *
 * Env:
 *   ADZUNA_APP_ID          — required (https://developer.adzuna.com)
 *   ADZUNA_APP_KEY         — required
 *   ADZUNA_SEARCH_QUERIES  — comma-separated keywords (default list below)
 *   ADZUNA_MAX_DAYS_OLD    — 1 | 3 | 7 (default: 1 = last 24h, freshest)
 *   ADZUNA_MAX_JOBS        — max jobs per query (default: 300)
 *
 * Free tier budget: 250 API calls/day.
 * At 12 queries × ~3 pages (50 results/page) × 4 runs/day = ~144 calls/day.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { bumpHarvestForActiveCompanies } from "@/lib/harvester/freshness-signal"
import {
  searchAdzunaAllPages,
  adzunaContractToEmploymentType,
  type AdzunaJob,
} from "@/lib/sources/adzuna"
import { isValidCompanyName } from "@/lib/sources/company-name-guard"

export const runtime = "nodejs"
export const maxDuration = 300

const DEFAULT_QUERIES = [
  "software engineer",
  "frontend developer",
  "backend developer",
  "full stack developer",
  "data engineer",
  "data scientist",
  "machine learning engineer",
  "devops engineer",
  "cloud engineer",
  "product manager",
  "site reliability engineer",
  "software developer",
  "mobile developer",
  "android developer",
  "ios developer",
  "react developer",
  "python developer",
  "java developer",
  "node developer",
  "qa engineer",
  "security engineer",
  "solutions architect",
  "engineering manager",
  "technical program manager",
  "ui ux designer",
  "business analyst",
  "data analyst",
  "financial analyst",
  "sales engineer",
  "account executive",
]

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const queryOverride = url.searchParams.get("q")
  const queries = queryOverride
    ? [queryOverride]
    : (process.env.ADZUNA_SEARCH_QUERIES ?? "")
        .split(",")
        .map((q) => q.trim())
        .filter(Boolean)
        .concat(DEFAULT_QUERIES)
        .filter((q, i, arr) => arr.indexOf(q) === i)
        .slice(0, 30)

  const maxDaysOld = Number(url.searchParams.get("maxDaysOld") ?? process.env.ADZUNA_MAX_DAYS_OLD ?? "1")
  const maxJobs = Number(url.searchParams.get("maxJobs") ?? process.env.ADZUNA_MAX_JOBS ?? "300")

  const pool = getPostgresPool()
  const stats: Record<string, number> = {
    queries: 0, fetched: 0, inserted: 0, updated: 0, errors: 0, harvestBumped: 0,
  }

  // Dedupe across queries by Adzuna job ID
  const seen = new Map<string, AdzunaJob>()

  for (const q of queries) {
    try {
      const jobs = await searchAdzunaAllPages({ what: q, maxDaysOld, sortBy: "date" }, maxJobs)
      stats.queries++
      for (const job of jobs) {
        if (!seen.has(job.id) && isValidCompanyName(job.company)) seen.set(job.id, job)
      }
      stats.fetched = seen.size
    } catch (err) {
      console.error(`[adzuna-ingest] query "${q}" failed:`, err)
      stats.errors++
    }
  }

  if (seen.size === 0) {
    return NextResponse.json({ ...stats, message: "No jobs fetched" })
  }

  // Group by normalized company name for batch resolution
  const byCompany = new Map<string, AdzunaJob[]>()
  for (const job of seen.values()) {
    const key = job.company.toLowerCase().trim()
    if (!byCompany.has(key)) byCompany.set(key, [])
    byCompany.get(key)!.push(job)
  }

  // Bulk lookup existing companies
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

  // Create placeholder companies for unknowns so the FK is satisfied.
  // discover-tenants will resolve their ATS on its next run.
  const missing = companyNames.filter((n) => !companyIdMap.has(n))
  for (const normName of missing) {
    const sample = byCompany.get(normName)![0]
    try {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO companies (name, domain, careers_url, is_active, raw_ats_config)
         VALUES ($1, $2, $3, false, $4)
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          sample.company,
          deriveDomain(sample.company),
          `https://www.adzuna.com/search?q=${encodeURIComponent(sample.company)}`,
          JSON.stringify({ source: "adzuna", crawl_allowed: false }),
        ]
      )
      if (res.rows[0]) companyIdMap.set(normName, res.rows[0].id)
    } catch {
      // Domain conflict — skip this company's jobs
    }
  }

  // Bulk-check which external_ids already exist
  const allExternalIds = [...seen.values()].map((j) => `adzuna:${j.id}`)
  const existingRows = await pool.query<{ id: string; external_id: string }>(
    `SELECT id, external_id FROM jobs WHERE external_id = ANY($1)`,
    [allExternalIds]
  )
  const existingByExtId = new Map(existingRows.rows.map((r) => [r.external_id, r.id]))

  // Upsert jobs
  for (const job of seen.values()) {
    const companyId = companyIdMap.get(job.company.toLowerCase().trim())
    if (!companyId) continue

    const externalId = `adzuna:${job.id}`
    const employmentType = adzunaContractToEmploymentType(job.contractType)
    const isRemote = /remote/i.test(job.location) || /remote/i.test(job.title)
    const salaryMin = job.salaryIsPredicted ? undefined : job.salaryMin
    const salaryMax = job.salaryIsPredicted ? undefined : job.salaryMax
    const firstDetected = new Date(job.created).toISOString()
    const rawData = JSON.stringify({ source: "adzuna", category: job.category, salaryIsPredicted: job.salaryIsPredicted })
    const existingId = existingByExtId.get(externalId)

    try {
      if (existingId) {
        await pool.query(
          `UPDATE jobs SET
             title=$1, location=$2, is_remote=$3,
             employment_type=$4, description=$5,
             salary_min=$6, salary_max=$7, salary_currency='USD',
             is_active=true, last_seen_at=NOW(), updated_at=NOW(), raw_data=$8
           WHERE id=$9`,
          [job.title, job.location, isRemote, employmentType,
           job.description || null, salaryMin ?? null, salaryMax ?? null,
           rawData, existingId]
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
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'USD',
             true, NOW(), $11, NOW(), NOW(), $12
           )`,
          [companyId, job.title, job.location, isRemote,
           employmentType, job.description || null, job.applyUrl, externalId,
           salaryMin ?? null, salaryMax ?? null,
           firstDetected, rawData]
        )
        stats.inserted++
      }
    } catch (err) {
      console.error(`[adzuna-ingest] failed to upsert job ${job.id}:`, err)
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

  // Bump known ATS companies forward — an Adzuna hit means they're actively
  // hiring right now, so pull their real ATS board's next harvest to now().
  try {
    stats.harvestBumped = await bumpHarvestForActiveCompanies(pool, [...companyIdMap.values()])
  } catch (err) {
    console.error("[adzuna-ingest] harvest bump failed:", err)
  }

  return NextResponse.json({ ok: true, ...stats })
}

function deriveDomain(companyName: string): string {
  return `adzuna-${companyName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40)}.placeholder`
}
