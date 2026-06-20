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
 * At 85 queries × ~10 pages (50 results/page) × 4 runs/day = ~3,400 calls/day.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { bumpHarvestForActiveCompanies } from "@/lib/harvester/freshness-signal"
import {
  AdzunaApiError,
  searchAdzunaAllPages,
  adzunaContractToEmploymentType,
  type AdzunaJob,
} from "@/lib/sources/adzuna"
import { isValidCompanyName } from "@/lib/sources/company-name-guard"
import { normalizePersistedJobRecord } from "@/lib/jobs/normalization"
import { publicationStatusForJob } from "@/lib/jobs/publication"
import { safeJsonStringify } from "@/lib/jobs/json-sanitize"
import type { EmploymentType } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 300

const DEFAULT_QUERIES = [
  // Engineering & Tech
  "software engineer",
  "frontend developer",
  "backend developer",
  "full stack developer",
  "data engineer",
  "data scientist",
  "machine learning engineer",
  "devops engineer",
  "cloud engineer",
  "site reliability engineer",
  "software developer",
  "mobile developer",
  "android developer",
  "ios developer",
  "react developer",
  "python developer",
  "java developer",
  "qa engineer",
  "security engineer",
  "solutions architect",
  "embedded engineer",
  "firmware engineer",
  "database administrator",
  "network engineer",
  "systems engineer",
  "platform engineer",
  "infrastructure engineer",
  // Product & Design
  "product manager",
  "technical program manager",
  "ui ux designer",
  "product designer",
  "engineering manager",
  // Data & Analytics
  "data analyst",
  "business intelligence analyst",
  "analytics engineer",
  "quantitative analyst",
  // Finance & Accounting
  "financial analyst",
  "accountant",
  "controller",
  "finance manager",
  "investment analyst",
  "actuarial analyst",
  "risk analyst",
  "tax manager",
  "audit manager",
  // Sales & Marketing
  "account executive",
  "sales engineer",
  "sales manager",
  "marketing manager",
  "digital marketing manager",
  "growth manager",
  "demand generation manager",
  "content marketing manager",
  "seo manager",
  "brand manager",
  "business development manager",
  // Operations & Supply Chain
  "operations manager",
  "supply chain manager",
  "logistics manager",
  "project manager",
  "program manager",
  "process engineer",
  "manufacturing engineer",
  "quality engineer",
  "industrial engineer",
  // Healthcare
  "registered nurse",
  "nurse practitioner",
  "physician assistant",
  "clinical research associate",
  "medical director",
  "pharmacist",
  "physical therapist",
  "occupational therapist",
  "radiologist",
  "healthcare administrator",
  // HR & Legal
  "human resources manager",
  "recruiter",
  "talent acquisition manager",
  "attorney",
  "paralegal",
  "compliance manager",
  // Customer Success & Support
  "customer success manager",
  "customer experience manager",
  "technical support engineer",
  // Other
  "business analyst",
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

  const maxDaysOld = Number(url.searchParams.get("maxDaysOld") ?? process.env.ADZUNA_MAX_DAYS_OLD ?? "2")
  const maxJobs = Number(url.searchParams.get("maxJobs") ?? process.env.ADZUNA_MAX_JOBS ?? "500")

  const pool = getPostgresPool()
  const stats: Record<string, number> = {
    queries: 0, fetched: 0, inserted: 0, updated: 0, errors: 0, upstreamErrors: 0, harvestBumped: 0,
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
      if (err instanceof AdzunaApiError) {
        console.warn("[adzuna-ingest] query failed after retries", {
          query: q,
          status: err.status,
          retryable: err.retryable,
          bodyPreview: err.bodyPreview,
        })
        stats.upstreamErrors++
      } else {
        console.error(`[adzuna-ingest] query "${q}" failed:`, err)
      }
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
  // Tracks companies we harvest directly — Adzuna jobs from these are redundant.
  const harvestedCompanyIds = new Set<string>()

  const existingResult = await pool.query<{ id: string; name: string; ats_type: string | null; is_active: boolean }>(
    `SELECT id, LOWER(TRIM(name)) AS name, ats_type, is_active
     FROM companies
     WHERE LOWER(TRIM(name)) = ANY($1)`,
    [companyNames]
  )
  for (const row of existingResult.rows) {
    companyIdMap.set(row.name, row.id)
    if (row.ats_type && row.is_active) harvestedCompanyIds.add(row.id)
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
    const existingId = existingByExtId.get(externalId)

    // Adzuna returns full descriptions but zero structured metadata. Run the
    // deterministic normalizer (same one the harvester/description-enrichment
    // path uses) to extract skills, seniority, normalized title, etc. — without
    // this, every adzuna job lands at 0% skills and stays that way.
    const norm = normalizePersistedJobRecord({
      id: existingId ?? "",
      title: job.title,
      normalized_title: null,
      location: job.location,
      apply_url: job.applyUrl,
      external_id: externalId,
      description: job.description || null,
      employment_type: employmentType as EmploymentType | null,
      seniority_level: null,
      is_remote: isRemote,
      is_hybrid: false,
      salary_min: salaryMin ?? null,
      salary_max: salaryMax ?? null,
      salary_currency: "USD",
      sponsors_h1b: null,
      sponsorship_score: 0,
      requires_authorization: false,
      visa_language_detected: null,
      skills: [],
      first_detected_at: firstDetected,
      raw_data: { source: "adzuna", category: job.category, salaryIsPredicted: job.salaryIsPredicted },
    })
    const nc = norm.nextColumns
    const basePublicationStatus = publicationStatusForJob({
      description: nc.description,
      skills: nc.skills,
    })
    const descLen = nc.description?.length ?? 0
    const skillCount = nc.skills?.length ?? 0
    // Adzuna truncates descriptions at ~500 chars; redirect URLs are behind AWS
    // WAF so enrichment is impossible. Hide jobs that add no signal:
    //   • description < 400 chars — too short to be useful
    //   • description 490-525 (at the truncation ceiling) with 0-1 skills
    //     — typically staffing-agency boilerplate with no tech keywords
    //   • from a company we harvest directly — the harvested version is richer
    const likelyTruncated = descLen >= 490 && descLen <= 525
    const redundantHarvested = harvestedCompanyIds.has(companyId)
    const publicationStatus =
      basePublicationStatus === "published" &&
      (descLen < 400 || (likelyTruncated && skillCount <= 1) || redundantHarvested)
        ? "hidden_low_quality"
        : basePublicationStatus
    const rawData = safeJsonStringify({
      source: "adzuna",
      category: job.category,
      salaryIsPredicted: job.salaryIsPredicted,
      description_captured: Boolean(nc.description),
      normalization: {
        version: norm.canonical.schema_version,
        normalized_at: norm.canonical.normalized_at,
        confidence_score: norm.canonical.validation.confidence_score,
        completeness_score: norm.canonical.validation.completeness_score,
        requires_review: norm.canonical.validation.requires_review,
        issues: norm.canonical.validation.issues,
      },
      normalized: norm.canonical,
      structured_job: norm.structuredData,
      view: { page: norm.pageView, card: norm.cardView },
    })

    try {
      if (existingId) {
        await pool.query(
          `UPDATE jobs SET
             title=$1, normalized_title=$2, location=$3, is_remote=$4, is_hybrid=$5,
             employment_type=$6, seniority_level=$7, description=$8,
             salary_min=$9, salary_max=$10, salary_currency=$11,
             requires_authorization=$12, sponsors_h1b=$13, sponsorship_score=$14,
             visa_language_detected=$15, skills=$16, publication_status=$17,
             is_active=true, last_seen_at=NOW(), updated_at=NOW(), raw_data=$18
           WHERE id=$19`,
          [job.title, nc.normalized_title, nc.location, nc.is_remote, nc.is_hybrid,
           nc.employment_type, nc.seniority_level, nc.description,
           nc.salary_min, nc.salary_max, nc.salary_currency ?? "USD",
           nc.requires_authorization, nc.sponsors_h1b, nc.sponsorship_score,
           nc.visa_language_detected, nc.skills, publicationStatus,
           rawData, existingId]
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
             is_active, last_seen_at, first_detected_at,
             created_at, updated_at, raw_data
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             true, NOW(), $21, NOW(), NOW(), $22
           )`,
          [companyId, job.title, nc.normalized_title, nc.location, nc.is_remote, nc.is_hybrid,
           nc.employment_type, nc.seniority_level, nc.description, job.applyUrl, externalId,
           nc.salary_min, nc.salary_max, nc.salary_currency ?? "USD",
           nc.requires_authorization, nc.sponsors_h1b, nc.sponsorship_score,
           nc.visa_language_detected, nc.skills, publicationStatus,
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
