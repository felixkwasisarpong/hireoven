/**
 * GET /api/cron/careerjet-ingest
 *
 * Pulls US jobs from CareerJet's free affiliate API.
 * Register at https://www.careerjet.com/partners/api/ to get an affiliate ID.
 *
 * Env:
 *   CAREERJET_AFFILIATE_ID  — required (free, register at careerjet.com)
 *   CAREERJET_SEARCH_QUERIES — comma-separated keywords (default list below)
 *   CAREERJET_MAX_JOBS       — max jobs per query (default: 99, API max per page)
 *   CAREERJET_MAX_PAGES      — pages per query (default: 3)
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

const DEFAULT_QUERIES = [
  "software engineer",
  "data engineer",
  "product manager",
  "devops engineer",
  "machine learning engineer",
  "registered nurse",
  "financial analyst",
  "operations manager",
  "sales manager",
  "marketing manager",
  "project manager",
  "accountant",
  "human resources manager",
  "business analyst",
  "customer success manager",
  "supply chain manager",
  "security engineer",
  "cloud engineer",
  "data scientist",
  "solutions architect",
]

type CareerJetJob = {
  date: string
  title: string
  locations: string
  company: string
  salary: string
  description: string
  url: string
  site: string
}

type CareerJetResponse = {
  type: string
  hits: number
  jobs?: CareerJetJob[]
  error?: string
}

async function fetchCareerJetPage(
  keywords: string,
  affiliateId: string,
  page: number,
  pageSize: number
): Promise<CareerJetJob[]> {
  const params = new URLSearchParams({
    keywords,
    location: "USA",
    locale_code: "en_US",
    affid: affiliateId,
    format: "json",
    pagesize: String(pageSize),
    page: String(page),
    sort: "date",
  })
  const url = `https://public.api.careerjet.com/search?${params}`
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "Hireoven/1.0" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const data = await res.json() as CareerJetResponse
    return data.jobs ?? []
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const affiliateId = process.env.CAREERJET_AFFILIATE_ID
  if (!affiliateId) {
    return NextResponse.json({ skipped: true, reason: "CAREERJET_AFFILIATE_ID not configured" })
  }

  const sp = request.nextUrl.searchParams
  const maxJobsPerQuery = Number(sp.get("maxJobs") ?? process.env.CAREERJET_MAX_JOBS ?? "99")
  const maxPages = Number(sp.get("maxPages") ?? process.env.CAREERJET_MAX_PAGES ?? "3")
  const queries = (sp.get("q") ? [sp.get("q")!] :
    (process.env.CAREERJET_SEARCH_QUERIES ?? "")
      .split(",").map((q) => q.trim()).filter(Boolean)
      .concat(DEFAULT_QUERIES)
      .filter((q, i, arr) => arr.indexOf(q) === i))

  const pool = getPostgresPool()
  const stats = { queries: 0, fetched: 0, inserted: 0, updated: 0, errors: 0 }
  const seen = new Map<string, CareerJetJob>()

  for (const q of queries) {
    try {
      for (let page = 1; page <= maxPages; page++) {
        const jobs = await fetchCareerJetPage(q, affiliateId, page, maxJobsPerQuery)
        if (jobs.length === 0) break
        for (const job of jobs) {
          if (!job.url || !isValidCompanyName(job.company)) continue
          if (!seen.has(job.url)) seen.set(job.url, job)
        }
        if (jobs.length < maxJobsPerQuery) break
      }
      stats.queries++
      stats.fetched = seen.size
    } catch (err) {
      console.error(`[careerjet-ingest] query "${q}" failed:`, err)
      stats.errors++
    }
  }

  if (seen.size === 0) return NextResponse.json({ ...stats, message: "No jobs fetched" })

  // Group by normalized company name
  const byCompany = new Map<string, CareerJetJob[]>()
  for (const job of seen.values()) {
    const key = job.company.toLowerCase().trim()
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
    const domain = `careerjet-${normName.replace(/[^a-z0-9]/g, "-")}.placeholder`
    try {
      if (sample.url) {
        const enrolled = await enrollFromApplyUrl(pool, {
          companyName: sample.company,
          applyUrl: sample.url,
          companyDomain: null,
          logoUrl: null,
          source: "careerjet",
        })
        if (enrolled) { companyIdMap.set(normName, enrolled.id); continue }
      }
      const res = await pool.query<{ id: string }>(
        `INSERT INTO companies (name, domain, careers_url, is_active, raw_ats_config)
         VALUES ($1, $2, null, false, $3)
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [sample.company, domain, JSON.stringify({ source: "careerjet", crawl_allowed: false })]
      )
      if (res.rows[0]) companyIdMap.set(normName, res.rows[0].id)
    } catch { /* domain conflict */ }
  }

  // Dedupe key = URL (CareerJet has no stable job ID)
  const allExtIds = [...seen.keys()].map((url) => `careerjet:${Buffer.from(url).toString("base64").slice(0, 64)}`)
  const existingRows = await pool.query<{ id: string; external_id: string }>(
    `SELECT id, external_id FROM jobs WHERE external_id = ANY($1)`,
    [allExtIds]
  )
  const existingByExtId = new Map(existingRows.rows.map((r) => [r.external_id, r.id]))

  for (const [url, job] of seen.entries()) {
    const companyId = companyIdMap.get(job.company.toLowerCase().trim())
    if (!companyId) continue

    const externalId = `careerjet:${Buffer.from(url).toString("base64").slice(0, 64)}`
    const existingId = existingByExtId.get(externalId)
    const postedAt = new Date(job.date).toISOString()

    const norm = normalizePersistedJobRecord({
      id: existingId ?? "",
      title: job.title,
      normalized_title: null,
      location: job.locations || null,
      apply_url: job.url,
      external_id: externalId,
      description: job.description || null,
      employment_type: null,
      seniority_level: null,
      is_remote: false,
      is_hybrid: false,
      salary_min: null,
      salary_max: null,
      salary_currency: "USD",
      sponsors_h1b: null,
      sponsorship_score: 0,
      requires_authorization: false,
      visa_language_detected: null,
      skills: [],
      first_detected_at: postedAt,
      raw_data: { source: "careerjet", salary_raw: job.salary, site: job.site },
    })
    const nc = norm.nextColumns
    const publicationStatus = publicationStatusForJob({ description: nc.description, skills: nc.skills })
    const rawData = JSON.stringify({
      source: "careerjet", salary_raw: job.salary, site: job.site, normalized: norm.canonical,
    })

    try {
      if (existingId) {
        await pool.query(
          `UPDATE jobs SET title=$1, normalized_title=$2, location=$3, is_remote=$4,
             employment_type=$5, seniority_level=$6, description=$7, skills=$8,
             requires_authorization=$9, sponsors_h1b=$10, sponsorship_score=$11,
             visa_language_detected=$12, publication_status=$13,
             is_active=true, last_seen_at=NOW(), updated_at=NOW(), raw_data=$14
           WHERE id=$15`,
          [job.title, nc.normalized_title, nc.location, nc.is_remote,
           nc.employment_type, nc.seniority_level, nc.description, nc.skills,
           nc.requires_authorization, nc.sponsors_h1b, nc.sponsorship_score,
           nc.visa_language_detected, publicationStatus, rawData, existingId]
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
          [companyId, job.title, nc.normalized_title, nc.location, nc.is_remote, false,
           nc.employment_type, nc.seniority_level, nc.description, job.url, externalId,
           nc.salary_min, nc.salary_max, nc.salary_currency ?? "USD",
           nc.requires_authorization, nc.sponsors_h1b, nc.sponsorship_score,
           nc.visa_language_detected, nc.skills, publicationStatus,
           postedAt, rawData]
        )
        stats.inserted++
      }
    } catch (err) {
      console.error("[careerjet-ingest] job upsert failed:", err)
      stats.errors++
    }
  }

  return NextResponse.json(stats)
}
