/**
 * GET /api/cron/dice-ingest
 *
 * Pulls fresh jobs from the Dice.com search API and upserts them into
 * the jobs table. For each unique company name, finds an existing company
 * row or creates a lightweight placeholder so the FK is satisfied.
 *
 * Env:
 *   DICE_SEARCH_QUERIES  comma-separated list of search terms (default below)
 *   DICE_POSTED_DATE     ONE_DAY_AGO | THREE_DAYS_AGO | SEVEN_DAYS_AGO (default: THREE_DAYS_AGO)
 *   DICE_MAX_JOBS        max jobs per query (default: 300)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  searchDiceAllPages,
  parseDiceSalary,
  parseDiceWorkMode,
  type DiceJob,
} from "@/lib/sources/dice"

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
]

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const queryOverride = url.searchParams.get("q")
  const queries = queryOverride
    ? [queryOverride]
    : (process.env.DICE_SEARCH_QUERIES ?? "")
        .split(",")
        .map((q) => q.trim())
        .filter(Boolean)
        .concat(DEFAULT_QUERIES)
        .filter((q, i, arr) => arr.indexOf(q) === i)
        .slice(0, 20)

  const postedDate = url.searchParams.get("postedDate") ?? process.env.DICE_POSTED_DATE ?? "THREE_DAYS_AGO"
  const maxJobs = Number(url.searchParams.get("maxJobs") ?? process.env.DICE_MAX_JOBS ?? "300")

  const pool = getPostgresPool()
  const stats = { queries: 0, fetched: 0, inserted: 0, updated: 0, errors: 0 }

  // Dedupe across queries by Dice job ID
  const seen = new Map<string, DiceJob>()

  for (const q of queries) {
    try {
      const jobs = await searchDiceAllPages({ q, postedDate }, maxJobs)
      stats.queries++
      for (const job of jobs) {
        if (!seen.has(job.id)) seen.set(job.id, job)
      }
      stats.fetched = seen.size
    } catch (err) {
      console.error(`[dice-ingest] query "${q}" failed:`, err)
      stats.errors++
    }
  }

  if (seen.size === 0) {
    return NextResponse.json({ ...stats, message: "No jobs fetched" })
  }

  // Group jobs by company name for batch company resolution
  const byCompany = new Map<string, DiceJob[]>()
  for (const job of seen.values()) {
    const key = job.company.toLowerCase().trim()
    if (!byCompany.has(key)) byCompany.set(key, [])
    byCompany.get(key)!.push(job)
  }

  // Resolve or create company rows
  const companyIdMap = new Map<string, string>() // normalized name → company UUID

  const companyNames = [...byCompany.keys()]
  // Bulk lookup existing companies by normalized name
  const existingResult = await pool.query<{ id: string; name: string }>(
    `SELECT id, LOWER(TRIM(name)) AS name
     FROM companies
     WHERE LOWER(TRIM(name)) = ANY($1)`,
    [companyNames]
  )
  for (const row of existingResult.rows) {
    companyIdMap.set(row.name, row.id)
  }

  // Create placeholder companies for any that don't exist yet
  const missing = companyNames.filter((n) => !companyIdMap.has(n))
  for (const normName of missing) {
    const jobs = byCompany.get(normName)!
    const sample = jobs[0]
    try {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO companies (name, domain, careers_url, is_active, raw_ats_config)
         VALUES ($1, $2, $3, false, $4)
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          sample.company,
          deriveDomain(sample.companyPageUrl ?? sample.applyUrl, sample.company),
          sample.companyPageUrl ?? `https://www.dice.com/jobs/q-${encodeURIComponent(sample.company)}`,
          JSON.stringify({ source: "dice", crawl_allowed: false }),
        ]
      )
      if (res.rows[0]) companyIdMap.set(normName, res.rows[0].id)
    } catch {
      // If domain conflict can't resolve, skip this company's jobs
    }
  }

  // Bulk-check which external_ids already exist
  const allExternalIds = [...seen.values()].map((j) => `dice:${j.id}`)
  const existingRows = await pool.query<{ id: string; external_id: string }>(
    `SELECT id, external_id FROM jobs WHERE external_id = ANY($1)`,
    [allExternalIds]
  )
  const existingByExtId = new Map(existingRows.rows.map((r) => [r.external_id, r.id]))

  // Insert new + update existing
  for (const job of seen.values()) {
    const companyId = companyIdMap.get(job.company.toLowerCase().trim())
    if (!companyId) continue

    const { min: salaryMin, max: salaryMax, currency } = parseDiceSalary(job.salary)
    const { isRemote, isHybrid } = parseDiceWorkMode(job.workFromHome)
    const externalId = `dice:${job.id}`
    const employmentType = job.employmentType?.toLowerCase().replace("_", "-") ?? null
    const rawData = JSON.stringify({ source: "dice", diceId: job.id, workFromHome: job.workFromHome, easyApply: job.easyApply })
    const firstDetected = job.postedDate ? new Date(job.postedDate).toISOString() : new Date().toISOString()

    const existingId = existingByExtId.get(externalId)

    try {
      if (existingId) {
        await pool.query(
          `UPDATE jobs SET
             title=$1, location=$2, is_remote=$3, is_hybrid=$4,
             employment_type=$5, description=$6, salary_min=$7,
             salary_max=$8, salary_currency=$9, is_active=true,
             last_seen_at=NOW(), updated_at=NOW(), raw_data=$10
           WHERE id=$11`,
          [job.title, job.location, isRemote, isHybrid, employmentType,
           job.summary, salaryMin ?? null, salaryMax ?? null, currency,
           rawData, existingId]
        )
        stats.updated++
      } else {
        await pool.query(
          `INSERT INTO jobs (
             company_id, title, location, is_remote, is_hybrid,
             employment_type, description, apply_url, external_id,
             salary_min, salary_max, salary_currency,
             is_active, last_seen_at, first_detected_at,
             created_at, updated_at, raw_data
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             true, NOW(), $13, NOW(), NOW(), $14
           )`,
          [companyId, job.title, job.location, isRemote, isHybrid,
           employmentType, job.summary, job.applyUrl, externalId,
           salaryMin ?? null, salaryMax ?? null, currency,
           firstDetected, rawData]
        )
        stats.inserted++
      }
    } catch (err) {
      console.error(`[dice-ingest] failed to upsert job ${job.id}:`, err)
      stats.errors++
    }
  }

  // Update job_count on affected companies
  await pool.query(
    `UPDATE companies c
     SET job_count = (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.is_active = true)
     WHERE c.id = ANY($1)`,
    [[...companyIdMap.values()]]
  )

  return NextResponse.json({ ok: true, ...stats })
}

function deriveDomain(url: string | undefined, companyName: string): string {
  if (url) {
    try {
      const u = new URL(url)
      if (!u.hostname.includes("dice.com")) return u.hostname.replace(/^www\./, "")
    } catch {}
  }
  // Fallback: slug the company name as a fake domain placeholder
  return `dice-${companyName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40)}.placeholder`
}
