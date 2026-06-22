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
import { isAtsDomain } from "@/lib/companies/ats-domains"
import { companyLogoUrlFromDomain, isLogoUrlSafe, normalizeCompanyDomain } from "@/lib/companies/logo-url"
import { bumpHarvestForActiveCompanies } from "@/lib/harvester/freshness-signal"
import { enrollFromApplyUrl } from "@/lib/harvester/discovery/enroll-from-apply-url"
import { isValidCompanyName } from "@/lib/sources/company-name-guard"
import { normalizePersistedJobRecord } from "@/lib/jobs/normalization"
import { publicationStatusForNormalization } from "@/lib/jobs/publication"
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
  logosResolved: number
  hiddenLowQuality: number
  removedEmptyCompanies: number
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

function normalizedRealDomain(domain: string | null | undefined): string | null {
  const normalized = normalizeCompanyDomain(domain ?? "")
  if (!normalized || normalized.endsWith(".placeholder") || isAtsDomain(normalized)) return null
  return normalized
}

function resolvedLogoForJob(job: AggregatorJob): string | null {
  if (isLogoUrlSafe(job.companyLogo)) return job.companyLogo!.trim()

  const domain = normalizedRealDomain(job.companyDomain)
  if (!domain) return null

  const logoUrl = companyLogoUrlFromDomain(domain, "logo-dev")
  return logoUrl || null
}

function shouldBackfillLogo(currentLogoUrl: string | null | undefined): boolean {
  if (!currentLogoUrl?.trim()) return true
  if (!isLogoUrlSafe(currentLogoUrl)) return true
  try {
    const host = new URL(currentLogoUrl).hostname.toLowerCase()
    return host.includes("google.com") || host.endsWith(".gstatic.com")
  } catch {
    return false
  }
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
    logosResolved: 0,
    hiddenLowQuality: 0,
    removedEmptyCompanies: 0,
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
  const logoBackfills = new Map<string, string>()
  const newlyCreatedCompanyIds = new Set<string>()
  const existing = await pool.query<{ id: string; name: string; logo_url: string | null }>(
    `SELECT id, LOWER(TRIM(name)) AS name, logo_url
       FROM companies
      WHERE LOWER(TRIM(name)) = ANY($1)`,
    [companyNames]
  )
  for (const row of existing.rows) {
    companyIdMap.set(row.name, row.id)
    const sample = byCompany.get(row.name)?.find((job) => resolvedLogoForJob(job)) ?? byCompany.get(row.name)?.[0]
    const logoUrl = sample ? resolvedLogoForJob(sample) : null
    if (logoUrl && shouldBackfillLogo(row.logo_url)) logoBackfills.set(row.id, logoUrl)
  }

  // Create companies for unknowns — ATS enrollment first, then placeholder.
  const missing = companyNames.filter((n) => !companyIdMap.has(n))
  for (const normName of missing) {
    const sample = byCompany.get(normName)![0]!
    const logoUrl = resolvedLogoForJob(sample)
    try {
      const enrolled = await enrollFromApplyUrl(pool, {
        companyName: sample.company,
        applyUrl: sample.applyUrl,
        companyDomain: sample.companyDomain ?? null,
        logoUrl,
        source,
      })
      if (enrolled) {
        companyIdMap.set(normName, enrolled.id)
        if (enrolled.enrolled) {
          stats.enrolled++
          newlyCreatedCompanyIds.add(enrolled.id)
        }
        continue
      }
      const domain = sample.companyDomain ?? deriveFallbackDomain(source, sample.company)
      const res = await pool.query<{ id: string; created: boolean }>(
        `INSERT INTO companies (name, domain, careers_url, is_active, logo_url, raw_ats_config)
         VALUES ($1, $2, $3, false, $4, $5)
         ON CONFLICT (domain) DO UPDATE
           SET name = EXCLUDED.name,
               logo_url = COALESCE(NULLIF(companies.logo_url, ''), EXCLUDED.logo_url),
               updated_at = CASE
                 WHEN EXCLUDED.logo_url IS NOT NULL AND NULLIF(companies.logo_url, '') IS NULL THEN NOW()
                 ELSE companies.updated_at
               END
         RETURNING id, (xmax = 0) AS created`,
        [
          sample.company,
          domain,
          sample.companyDomain ? `https://${sample.companyDomain}` : null,
          logoUrl,
          JSON.stringify({ source, publisher: sample.publisher, crawl_allowed: false }),
        ]
      )
      if (res.rows[0]) {
        companyIdMap.set(normName, res.rows[0].id)
        if (res.rows[0].created) {
          stats.placeholders++
          newlyCreatedCompanyIds.add(res.rows[0].id)
        }
      }
    } catch {
      // Domain conflict — skip this company's jobs.
    }
  }

  for (const [companyId, logoUrl] of logoBackfills) {
    try {
      const res = await pool.query(
        `UPDATE companies
            SET logo_url = $1, updated_at = NOW()
          WHERE id = $2
            AND (
              logo_url IS NULL OR trim(logo_url) = ''
              OR logo_url ILIKE '%google.com/s2/favicons%'
              OR logo_url ILIKE '%gstatic.com/favicon%'
            )`,
        [logoUrl, companyId]
      )
      stats.logosResolved += res.rowCount ?? 0
    } catch (err) {
      console.error(`[${source}-ingest] failed to backfill company logo ${companyId}:`, err)
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
    const basePublicationStatus = publicationStatusForNormalization(norm)
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

  if (newlyCreatedCompanyIds.size > 0) {
    const empty = await pool.query<{ id: string }>(
      `DELETE FROM companies c
        WHERE c.id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.company_id = c.id)
        RETURNING id`,
      [[...newlyCreatedCompanyIds]]
    )
    stats.removedEmptyCompanies = empty.rowCount ?? 0
    for (const row of empty.rows) {
      for (const [name, id] of companyIdMap.entries()) {
        if (id === row.id) companyIdMap.delete(name)
      }
    }
  }

  const touchedCompanyIds = [...new Set(companyIdMap.values())]

  // Refresh job_count on touched companies.
  if (touchedCompanyIds.length > 0) {
    await pool.query(
      `UPDATE companies c
          SET job_count = (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.is_active = true)
        WHERE c.id = ANY($1)`,
      [touchedCompanyIds]
    )
  }

  try {
    stats.harvestBumped = await bumpHarvestForActiveCompanies(pool, touchedCompanyIds)
  } catch (err) {
    console.error(`[${source}-ingest] harvest bump failed:`, err)
  }

  return stats
}
