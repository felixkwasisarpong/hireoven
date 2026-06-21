/**
 * Shared ingest pipeline for aggregator job sources (lib/sources/*).
 *
 * Adzuna, Dice and JSearch each grew their own ~560-line cron route. The Muse,
 * Remotive, RemoteOK, Arbeitnow, Jooble and Careerjet all return the same
 * normalized job shape, so they share this single pipeline instead of copying
 * that logic six more times. Each source's cron route just fetches its jobs,
 * maps them to `AggregatorJob`, and calls `ingestAggregatorJobs(pool, source, jobs)`.
 *
 * Behaviour (mirrors jsearch-ingest, generalised over `source`):
 *  - Dedupe by source job id; reject junk company names.
 *  - Resolve each company by name; for unknowns, try ATS enrollment from the
 *    apply URL first (creates a harvestable row), else insert a domain/name
 *    placeholder so the FK is satisfied and discover-tenants can resolve it.
 *  - Upsert each job under external_id `<source>:<id>`, running the deterministic
 *    normalizer so skills/seniority/normalized_title are populated.
 *  - Refresh job_count and bump known-ATS companies forward (active-hiring signal).
 */

import type { Pool } from "pg"
import { bumpHarvestForActiveCompanies } from "@/lib/harvester/freshness-signal"
import { enrollFromApplyUrl } from "@/lib/harvester/discovery/enroll-from-apply-url"
import { isValidCompanyName } from "@/lib/sources/company-name-guard"
import { normalizePersistedJobRecord } from "@/lib/jobs/normalization"
import { publicationStatusForJob } from "@/lib/jobs/publication"
import type { EmploymentType } from "@/types"

/** Normalized job shape every aggregator source maps into. */
export interface AggregatorJob {
  id: string
  title: string
  company: string
  companyDomain?: string
  companyLogo?: string
  location: string
  description: string
  applyUrl: string
  postedAt: string
  isRemote: boolean
  employmentType?: string
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
  /** Optional pre-seeded skills/tags (e.g. Remotive tags). Merged by the normalizer. */
  skills?: string[]
  /** Optional upstream publisher/board label, stored in raw_data. */
  publisher?: string
}

export interface IngestOptions {
  /** Hide jobs whose description is shorter than this (0 = never hide on length). */
  minDescriptionChars?: number
  /** Per-job extra fields merged into raw_data. */
  rawExtra?: (job: AggregatorJob) => Record<string, unknown>
}

export interface IngestStats {
  source: string
  fetched: number
  inserted: number
  updated: number
  enrolled: number
  placeholders: number
  hiddenLowQuality: number
  errors: number
  harvestBumped: number
}

function deriveFallbackDomain(source: string, companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40)
  return `${source}-${slug}.placeholder`
}

export async function ingestAggregatorJobs(
  pool: Pool,
  source: string,
  rawJobs: AggregatorJob[],
  options: IngestOptions = {}
): Promise<IngestStats> {
  const stats: IngestStats = {
    source,
    fetched: 0,
    inserted: 0,
    updated: 0,
    enrolled: 0,
    placeholders: 0,
    hiddenLowQuality: 0,
    errors: 0,
    harvestBumped: 0,
  }
  const minDesc = Math.max(0, options.minDescriptionChars ?? 0)

  // Dedupe by source job id; drop junk company names / apply-less rows.
  const seen = new Map<string, AggregatorJob>()
  for (const job of rawJobs) {
    if (!job.id || !job.applyUrl) continue
    if (!isValidCompanyName(job.company)) continue
    if (!seen.has(job.id)) seen.set(job.id, job)
  }
  stats.fetched = seen.size
  if (seen.size === 0) return stats

  // Group by normalized company name.
  const byCompany = new Map<string, AggregatorJob[]>()
  for (const job of seen.values()) {
    const key = job.company.toLowerCase().trim()
    if (!byCompany.has(key)) byCompany.set(key, [])
    byCompany.get(key)!.push(job)
  }

  // Resolve existing companies by lower(trim(name)).
  const companyNames = [...byCompany.keys()]
  const companyIdMap = new Map<string, string>()
  const existing = await pool.query<{ id: string; name: string }>(
    `SELECT id, LOWER(TRIM(name)) AS name
       FROM companies
      WHERE LOWER(TRIM(name)) = ANY($1)`,
    [companyNames]
  )
  for (const row of existing.rows) companyIdMap.set(row.name, row.id)

  // Create companies for unknowns — ATS enrollment first, then placeholder.
  const missing = companyNames.filter((n) => !companyIdMap.has(n))
  for (const normName of missing) {
    const sample = byCompany.get(normName)![0]!
    try {
      const enrolled = await enrollFromApplyUrl(pool, {
        companyName: sample.company,
        applyUrl: sample.applyUrl,
        companyDomain: sample.companyDomain ?? null,
        logoUrl: sample.companyLogo ?? null,
        source,
      })
      if (enrolled) {
        companyIdMap.set(normName, enrolled.id)
        if (enrolled.enrolled) stats.enrolled++
        continue
      }
      const domain = sample.companyDomain ?? deriveFallbackDomain(source, sample.company)
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
          JSON.stringify({ source, publisher: sample.publisher, crawl_allowed: false }),
        ]
      )
      if (res.rows[0]) {
        companyIdMap.set(normName, res.rows[0].id)
        stats.placeholders++
      }
    } catch {
      // Domain conflict — skip this company's jobs.
    }
  }

  // Bulk-check existing job external_ids.
  const allExternalIds = [...seen.values()].map((j) => `${source}:${j.id}`)
  const existingRows = await pool.query<{ id: string; external_id: string }>(
    `SELECT id, external_id FROM jobs WHERE external_id = ANY($1)`,
    [allExternalIds]
  )
  const existingByExtId = new Map(existingRows.rows.map((r) => [r.external_id, r.id]))

  for (const job of seen.values()) {
    const companyId = companyIdMap.get(job.company.toLowerCase().trim())
    if (!companyId) continue

    const externalId = `${source}:${job.id}`
    const parsedDate = new Date(job.postedAt)
    const firstDetected = Number.isNaN(parsedDate.getTime())
      ? new Date().toISOString()
      : parsedDate.toISOString()
    const existingId = existingByExtId.get(externalId)

    const norm = normalizePersistedJobRecord({
      id: existingId ?? "",
      title: job.title,
      normalized_title: null,
      location: job.location,
      apply_url: job.applyUrl,
      external_id: externalId,
      description: job.description || null,
      employment_type: (job.employmentType ?? null) as EmploymentType | null,
      seniority_level: null,
      is_remote: job.isRemote,
      is_hybrid: false,
      salary_min: job.salaryMin ?? null,
      salary_max: job.salaryMax ?? null,
      salary_currency: job.salaryCurrency ?? "USD",
      sponsors_h1b: null,
      sponsorship_score: 0,
      requires_authorization: false,
      visa_language_detected: null,
      skills: job.skills ?? [],
      first_detected_at: firstDetected,
      raw_data: { source, publisher: job.publisher },
    })
    const nc = norm.nextColumns
    const basePublicationStatus = publicationStatusForJob({
      description: nc.description,
      skills: nc.skills,
    })
    const descLen = nc.description?.length ?? 0
    const publicationStatus =
      basePublicationStatus === "published" && minDesc > 0 && descLen < minDesc
        ? "hidden_low_quality"
        : basePublicationStatus
    if (publicationStatus === "hidden_low_quality") stats.hiddenLowQuality++

    const rawData = JSON.stringify({
      source,
      publisher: job.publisher,
      description_captured: Boolean(nc.description),
      ...(options.rawExtra ? options.rawExtra(job) : {}),
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
      console.error(`[${source}-ingest] failed to upsert job ${job.id}:`, err)
      stats.errors++
    }
  }

  // Refresh job_count on touched companies.
  if (companyIdMap.size > 0) {
    await pool.query(
      `UPDATE companies c
          SET job_count = (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.is_active = true)
        WHERE c.id = ANY($1)`,
      [[...companyIdMap.values()]]
    )
  }

  try {
    stats.harvestBumped = await bumpHarvestForActiveCompanies(pool, [...companyIdMap.values()])
  } catch (err) {
    console.error(`[${source}-ingest] harvest bump failed:`, err)
  }

  return stats
}
