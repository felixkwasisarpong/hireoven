/**
 * GET /api/cron/remotive-ingest
 *
 * Pulls remote jobs from Remotive (https://remotive.io/api/remote-jobs).
 * Free, no API key required. Returns remote-only roles across all categories.
 *
 * Env:
 *   REMOTIVE_CATEGORIES — comma-separated categories (default list below)
 *   REMOTIVE_LIMIT      — jobs per category request (default: 100, max: unlimited)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { enrollFromApplyUrl } from "@/lib/harvester/discovery/enroll-from-apply-url"
import { isValidCompanyName } from "@/lib/sources/company-name-guard"
import { normalizePersistedJobRecord } from "@/lib/jobs/normalization"
import { publicationStatusForJob } from "@/lib/jobs/publication"

export const runtime = "nodejs"
export const maxDuration = 300

const DEFAULT_CATEGORIES = [
  "software-dev",
  "devops-sysadmin",
  "product",
  "design",
  "data",
  "qa",
  "security",
  "sales",
  "marketing",
  "finance-legal",
  "hr",
  "customer-support",
  "writing",
  "all-others",
]

type RemotiveJob = {
  id: number
  url: string
  title: string
  company_name: string
  company_logo: string | null
  category: string
  tags: string[]
  job_type: string | null
  publication_date: string
  candidate_required_location: string
  salary: string
  description: string
}

async function fetchRemotiveJobs(category: string, limit: number): Promise<RemotiveJob[]> {
  const url = `https://remotive.io/api/remote-jobs?category=${encodeURIComponent(category)}&limit=${limit}`
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "Hireoven/1.0" },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return []
    const data = await res.json() as { jobs?: RemotiveJob[] }
    return data.jobs ?? []
  } catch {
    return []
  }
}

function parseSalary(salaryStr: string): { min: number | null; max: number | null } {
  if (!salaryStr) return { min: null, max: null }
  const numbers = salaryStr.replace(/,/g, "").match(/\d+/g)?.map(Number) ?? []
  if (numbers.length === 0) return { min: null, max: null }
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] }
  return { min: Math.min(...numbers), max: Math.max(...numbers) }
}

function mapJobType(jobType: string | null): string | null {
  if (!jobType) return null
  const t = jobType.toLowerCase()
  if (t.includes("full")) return "fulltime"
  if (t.includes("part")) return "parttime"
  if (t.includes("contract")) return "contract"
  if (t.includes("intern")) return "internship"
  return null
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const limitPerCategory = Number(sp.get("limit") ?? process.env.REMOTIVE_LIMIT ?? "100")
  const categories = (sp.get("categories") ?? process.env.REMOTIVE_CATEGORIES ?? "")
    .split(",").map((c) => c.trim()).filter(Boolean)
    .concat(DEFAULT_CATEGORIES)
    .filter((c, i, arr) => arr.indexOf(c) === i)

  const pool = getPostgresPool()
  const stats = { categories: 0, fetched: 0, inserted: 0, updated: 0, errors: 0 }

  // Dedupe across categories by Remotive job ID
  const seen = new Map<string, RemotiveJob>()
  for (const cat of categories) {
    try {
      const jobs = await fetchRemotiveJobs(cat, limitPerCategory)
      stats.categories++
      for (const job of jobs) {
        const key = String(job.id)
        if (!seen.has(key) && isValidCompanyName(job.company_name)) seen.set(key, job)
      }
      stats.fetched = seen.size
    } catch (err) {
      console.error(`[remotive-ingest] category "${cat}" failed:`, err)
      stats.errors++
    }
  }

  if (seen.size === 0) return NextResponse.json({ ...stats, message: "No jobs fetched" })

  // Group by normalized company name
  const byCompany = new Map<string, RemotiveJob[]>()
  for (const job of seen.values()) {
    const key = job.company_name.toLowerCase().trim()
    if (!byCompany.has(key)) byCompany.set(key, [])
    byCompany.get(key)!.push(job)
  }

  const companyNames = [...byCompany.keys()]
  const companyIdMap = new Map<string, string>()

  const existingResult = await pool.query<{ id: string; name: string }>(
    `SELECT id, LOWER(TRIM(name)) AS name FROM companies WHERE LOWER(TRIM(name)) = ANY($1)`,
    [companyNames]
  )
  for (const row of existingResult.rows) companyIdMap.set(row.name, row.id)

  const missing = companyNames.filter((n) => !companyIdMap.has(n))
  for (const normName of missing) {
    const sample = byCompany.get(normName)![0]
    const domain = `remotive-${normName.replace(/[^a-z0-9]/g, "-")}.placeholder`
    try {
      if (sample.url) {
        const enrolled = await enrollFromApplyUrl(pool, {
          companyName: sample.company_name,
          applyUrl: sample.url,
          companyDomain: null,
          logoUrl: sample.company_logo,
          source: "remotive",
        })
        if (enrolled) { companyIdMap.set(normName, enrolled.id); continue }
      }
      const res = await pool.query<{ id: string }>(
        `INSERT INTO companies (name, domain, careers_url, is_active, logo_url, raw_ats_config)
         VALUES ($1, $2, $3, false, $4, $5)
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [sample.company_name, domain, null, sample.company_logo ?? null,
         JSON.stringify({ source: "remotive", crawl_allowed: false })]
      )
      if (res.rows[0]) companyIdMap.set(normName, res.rows[0].id)
    } catch { /* domain conflict */ }
  }

  // Bulk-check existing external_ids
  const allExtIds = [...seen.keys()].map((id) => `remotive:${id}`)
  const existingRows = await pool.query<{ id: string; external_id: string }>(
    `SELECT id, external_id FROM jobs WHERE external_id = ANY($1)`,
    [allExtIds]
  )
  const existingByExtId = new Map(existingRows.rows.map((r) => [r.external_id, r.id]))

  for (const job of seen.values()) {
    const companyId = companyIdMap.get(job.company_name.toLowerCase().trim())
    if (!companyId) continue

    const externalId = `remotive:${job.id}`
    const existingId = existingByExtId.get(externalId)
    const { min: salaryMin, max: salaryMax } = parseSalary(job.salary)

    const norm = normalizePersistedJobRecord({
      id: existingId ?? "",
      title: job.title,
      normalized_title: null,
      location: job.candidate_required_location || "Remote",
      apply_url: job.url,
      external_id: externalId,
      description: job.description || null,
      employment_type: mapJobType(job.job_type) as never,
      seniority_level: null,
      is_remote: true,
      is_hybrid: false,
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: "USD",
      sponsors_h1b: null,
      sponsorship_score: 0,
      requires_authorization: false,
      visa_language_detected: null,
      skills: job.tags ?? [],
      first_detected_at: new Date(job.publication_date).toISOString(),
      raw_data: { source: "remotive", category: job.category, tags: job.tags },
    })
    const nc = norm.nextColumns
    const publicationStatus = publicationStatusForJob({ description: nc.description, skills: nc.skills })
    const rawData = JSON.stringify({
      source: "remotive", category: job.category, tags: job.tags,
      normalized: norm.canonical,
    })

    try {
      if (existingId) {
        await pool.query(
          `UPDATE jobs SET title=$1, normalized_title=$2, location=$3, is_remote=$4, is_hybrid=$5,
             employment_type=$6, seniority_level=$7, description=$8,
             salary_min=$9, salary_max=$10, salary_currency=$11,
             requires_authorization=$12, sponsors_h1b=$13, sponsorship_score=$14,
             visa_language_detected=$15, skills=$16, publication_status=$17,
             is_active=true, last_seen_at=NOW(), updated_at=NOW(), raw_data=$18
           WHERE id=$19`,
          [job.title, nc.normalized_title, nc.location, true, false,
           nc.employment_type, nc.seniority_level, nc.description,
           nc.salary_min, nc.salary_max, nc.salary_currency ?? "USD",
           nc.requires_authorization, nc.sponsors_h1b, nc.sponsorship_score,
           nc.visa_language_detected, nc.skills, publicationStatus, rawData, existingId]
        )
        stats.updated++
      } else {
        await pool.query(
          `INSERT INTO jobs (
             company_id, title, normalized_title, location, is_remote, is_hybrid,
             employment_type, seniority_level, description, apply_url, external_id,
             salary_min, salary_max, salary_currency,
             requires_authorization, sponsors_h1b, sponsorship_score,
             visa_language_detected, skills, publication_status,
             is_active, last_seen_at, first_detected_at, created_at, updated_at, raw_data
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             true, NOW(), $21, NOW(), NOW(), $22
           ) ON CONFLICT (external_id) DO NOTHING`,
          [companyId, job.title, nc.normalized_title, nc.location, true, false,
           nc.employment_type, nc.seniority_level, nc.description, job.url, externalId,
           nc.salary_min, nc.salary_max, nc.salary_currency ?? "USD",
           nc.requires_authorization, nc.sponsors_h1b, nc.sponsorship_score,
           nc.visa_language_detected, nc.skills, publicationStatus,
           new Date(job.publication_date).toISOString(), rawData]
        )
        stats.inserted++
      }
    } catch (err) {
      console.error("[remotive-ingest] job upsert failed:", err)
      stats.errors++
    }
  }

  return NextResponse.json(stats)
}
