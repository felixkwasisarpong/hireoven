/**
 * GET /api/cron/adzuna-ingest
 *
 * Pulls fresh jobs from the Adzuna aggregator API (covers LinkedIn, Indeed,
 * company boards) and upserts them into the jobs table. Adzuna descriptions are
 * usually truncated around 500 chars and its redirect pages are WAF-protected,
 * so these jobs are treated as discovery/freshness signals unless the snippet is
 * clearly complete enough to publish.
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
 *   ADZUNA_COUNTRIES       — comma-separated Adzuna country endpoints (default: us,ca)
 *   ADZUNA_MAX_DAYS_OLD    — 1 | 3 | 7 (default: 1 = last 24h, freshest)
 *   ADZUNA_MAX_JOBS        — max jobs per query (default: 300)
 *
 * Free tier budget: 250 API calls/day.
 * At 85 queries × ~10 pages (50 results/page) × 4 runs/day = ~3,400 calls/day.
 */

import { NextRequest, NextResponse } from "next/server"
import pLimit from "p-limit"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { bumpHarvestForActiveCompanies } from "@/lib/harvester/freshness-signal"
import { backsolveAggregatorCompany } from "@/lib/jobs/aggregator-backsolve"
import {
  AdzunaApiError,
  adzunaContractToEmploymentType,
  isAdzunaDescriptionLikelyTruncated,
  normalizeAdzunaCompanyLookupKey,
  normalizeAdzunaJobFingerprintPart,
  searchAdzunaAllPages,
  type AdzunaJob,
} from "@/lib/sources/adzuna"
import { isValidCompanyName } from "@/lib/sources/company-name-guard"
import { normalizePersistedJobRecord } from "@/lib/jobs/normalization"
import { publicationStatusForNormalization } from "@/lib/jobs/publication"
import { safeJsonStringify } from "@/lib/jobs/json-sanitize"
import type { EmploymentType } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 300

// Per-company backsolve makes network calls; cap concurrency and stop opening
// new ones once we approach the budget so the cron tick still finishes.
const BACKSOLVE_CONCURRENCY = Number(process.env.AGGREGATOR_BACKSOLVE_CONCURRENCY ?? "4")
const BACKSOLVE_BUDGET_MS = Number(process.env.AGGREGATOR_BACKSOLVE_BUDGET_MS ?? "150000")

// Truncated Adzuna jobs are normally dropped (their ~500-char teaser can't be
// shown). With ADZUNA_ENRICH_TRUNCATED=true we instead persist them hidden as
// 'pending_enrichment', so the description-enrichment cron's Playwright fallback
// (which clears Adzuna's WAF — plain fetch gets 403) can fetch the full JD and
// promote them. Requires JOB_DESCRIPTION_ENRICHMENT_BROWSER=true on the worker.
const ENRICH_TRUNCATED = process.env.ADZUNA_ENRICH_TRUNCATED === "true"

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

type CompanyCandidate = {
  id: string
  name: string
  ats_type: string | null
  is_active: boolean
  domain: string
  job_count: number | null
}

function isPlaceholderDomain(domain: string | null | undefined): boolean {
  const value = (domain ?? "").toLowerCase()
  return (
    value.endsWith(".placeholder") ||
    value.endsWith(".invalid") ||
    value.endsWith(".ats-placeholder") ||
    value.endsWith(".builtin-discovery") ||
    value.endsWith(".glassdoor-discovery") ||
    value.startsWith("adzuna-") ||
    value.startsWith("dice-")
  )
}

function scoreCompanyCandidate(candidate: CompanyCandidate): number {
  return (
    (candidate.is_active && candidate.ats_type ? 1_000_000 : 0) +
    (candidate.is_active ? 100_000 : 0) +
    (!isPlaceholderDomain(candidate.domain) ? 10_000 : 0) +
    (candidate.ats_type ? 5_000 : 0) +
    Math.min(candidate.job_count ?? 0, 5_000)
  )
}

function chooseBestCompanyCandidate(candidates: CompanyCandidate[]): CompanyCandidate | null {
  return [...candidates].sort((a, b) => scoreCompanyCandidate(b) - scoreCompanyCandidate(a))[0] ?? null
}

function parseAdzunaCountries(raw: string | null | undefined): string[] {
  const countries = (raw ?? "us,ca")
    .split(",")
    .map((country) => country.trim().toLowerCase())
    .filter((country) => /^[a-z]{2}$/.test(country))
  return countries.length ? [...new Set(countries)] : ["us", "ca"]
}

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
  const countryOverride = url.searchParams.get("country")
  const countries = countryOverride
    ? parseAdzunaCountries(countryOverride)
    : parseAdzunaCountries(process.env.ADZUNA_COUNTRIES)

  const pool = getPostgresPool()
  const stats: Record<string, number> = {
    queries: 0,
    countries: countries.length,
    fetched: 0,
    inserted: 0,
    updated: 0,
    errors: 0,
    upstreamErrors: 0,
    harvestBumped: 0,
    canonicalCompanyMatches: 0,
    truncatedHidden: 0,
    skippedHiddenInsert: 0,
    insertedPendingEnrichment: 0,
    duplicateFingerprintSkipped: 0,
    duplicateFingerprintRefreshed: 0,
    backsolveEnrolled: 0,
    backsolveRetryLater: 0,
    backsolvePlaceholder: 0,
    backsolveDeadlineSkipped: 0,
  }
  const startedAt = Date.now()

  // Dedupe across queries by Adzuna job ID
  const seen = new Map<string, AdzunaJob>()

  for (const q of queries) {
    for (const country of countries) {
      try {
        const jobs = await searchAdzunaAllPages({ what: q, country, maxDaysOld, sortBy: "date" }, maxJobs)
        stats.queries++
        for (const job of jobs) {
          if (!seen.has(job.id) && isValidCompanyName(job.company)) seen.set(job.id, job)
        }
        stats.fetched = seen.size
      } catch (err) {
        if (err instanceof AdzunaApiError) {
          console.warn("[adzuna-ingest] query failed after retries", {
            query: q,
            country,
            status: err.status,
            retryable: err.retryable,
            bodyPreview: err.bodyPreview,
          })
          stats.upstreamErrors++
        } else {
          console.error(`[adzuna-ingest] query "${q}" (${country}) failed:`, err)
        }
        stats.errors++
      }
    }
  }

  if (seen.size === 0) {
    return NextResponse.json({ ...stats, message: "No jobs fetched" })
  }

  // Group by exact company name for batch resolution, but match through a
  // stripped key as well so "Microsoft Corporation" resolves to the active
  // "Microsoft" harvester row instead of an inactive aggregator placeholder.
  const byCompany = new Map<string, AdzunaJob[]>()
  const lookupKeyByCompany = new Map<string, string>()
  for (const job of seen.values()) {
    const key = job.company.toLowerCase().trim()
    if (!byCompany.has(key)) byCompany.set(key, [])
    byCompany.get(key)!.push(job)
    lookupKeyByCompany.set(key, normalizeAdzunaCompanyLookupKey(job.company))
  }

  // Bulk lookup existing companies
  const companyNames = [...byCompany.keys()]
  const companyIdMap = new Map<string, string>()
  // Tracks companies we harvest directly — Adzuna jobs from these are redundant.
  const harvestedCompanyIds = new Set<string>()

  const existingResult = await pool.query<CompanyCandidate>(
    `SELECT id, name, ats_type, is_active, domain, job_count
       FROM companies
      WHERE duplicate_of_company_id IS NULL`
  )
  const candidatesByExactName = new Map<string, CompanyCandidate[]>()
  const candidatesByLookupKey = new Map<string, CompanyCandidate[]>()
  for (const row of existingResult.rows) {
    const exact = row.name.toLowerCase().trim()
    const lookupKey = normalizeAdzunaCompanyLookupKey(row.name)
    if (!candidatesByExactName.has(exact)) candidatesByExactName.set(exact, [])
    candidatesByExactName.get(exact)!.push(row)
    if (lookupKey) {
      if (!candidatesByLookupKey.has(lookupKey)) candidatesByLookupKey.set(lookupKey, [])
      candidatesByLookupKey.get(lookupKey)!.push(row)
    }
  }

  for (const companyName of companyNames) {
    const exactCandidates = candidatesByExactName.get(companyName) ?? []
    const lookupKey = lookupKeyByCompany.get(companyName) ?? ""
    const lookupCandidates = lookupKey ? candidatesByLookupKey.get(lookupKey) ?? [] : []
    const best = chooseBestCompanyCandidate([...exactCandidates, ...lookupCandidates])
    if (!best) continue
    companyIdMap.set(companyName, best.id)
    if (!exactCandidates.some((candidate) => candidate.id === best.id)) {
      stats.canonicalCompanyMatches++
    }
    if (best.ats_type && best.is_active) harvestedCompanyIds.add(best.id)
  }

  // Resolve unknown companies. Jobs with an apply URL go through the backsolver
  // (resolve the real ATS board → enroll a harvestable company); jobs without
  // one keep the legacy placeholder path. Backsolving is network-bound, so it
  // runs at bounded concurrency and falls back to a fast placeholder once we
  // approach the budget (the next tick / discover-tenants handles the rest).
  const missing = companyNames.filter((n) => !companyIdMap.has(n))

  const insertPlaceholder = async (normName: string, discoveredVia: string) => {
    const sample = byCompany.get(normName)![0]
    try {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO companies (name, domain, careers_url, is_active, discovered_via, raw_ats_config)
         VALUES ($1, $2, $3, false, $4, $5)
         ON CONFLICT (domain) DO UPDATE
           SET name = EXCLUDED.name,
               discovered_via = COALESCE(companies.discovered_via, EXCLUDED.discovered_via)
         RETURNING id`,
        [
          sample.company,
          deriveDomain(sample.company),
          `https://www.adzuna.com/search?q=${encodeURIComponent(sample.company)}`,
          discoveredVia,
          JSON.stringify({ source: "adzuna", crawl_allowed: false }),
        ]
      )
      if (res.rows[0]) companyIdMap.set(normName, res.rows[0].id)
    } catch {
      // Domain conflict — skip this company's jobs (retried next tick).
    }
  }

  const backsolveLimit = pLimit(BACKSOLVE_CONCURRENCY)
  await Promise.all(
    missing.map((normName) =>
      backsolveLimit(async () => {
        if (Date.now() - startedAt > BACKSOLVE_BUDGET_MS) {
          stats.backsolveDeadlineSkipped++
          await insertPlaceholder(normName, "adzuna-deadline")
          return
        }
        const sample = byCompany.get(normName)![0]
        const outcome = await backsolveAggregatorCompany(pool, {
          source: "adzuna",
          applyUrl: sample.applyUrl,
          companyName: sample.company,
        })
        if (outcome.kind === "enrolled") {
          companyIdMap.set(normName, outcome.companyId)
          stats.backsolveEnrolled++
        } else if (outcome.kind === "retry_later") {
          stats.backsolveRetryLater++ // no company this tick
        } else {
          stats.backsolvePlaceholder++
          await insertPlaceholder(normName, outcome.discoveredVia)
        }
      })
    )
  )

  // Bulk-check which external_ids already exist
  const allExternalIds = [...seen.values()].map((j) => `adzuna:${j.id}`)
  const existingRows = await pool.query<{ id: string; external_id: string }>(
    `SELECT id, external_id FROM jobs WHERE external_id = ANY($1)`,
    [allExternalIds]
  )
  const existingByExtId = new Map(existingRows.rows.map((r) => [r.external_id, r.id]))

  const fingerprintCompanyIds: string[] = []
  const fingerprintTitleKeys: string[] = []
  const fingerprintLocationKeys: string[] = []
  const fingerprintByExternalId = new Map<string, string>()
  for (const job of seen.values()) {
    const companyId = companyIdMap.get(job.company.toLowerCase().trim())
    if (!companyId) continue

    const externalId = `adzuna:${job.id}`
    if (existingByExtId.has(externalId)) continue

    const titleKey = normalizeAdzunaJobFingerprintPart(job.title)
    const locationKey = normalizeAdzunaJobFingerprintPart(job.location)
    const fingerprint = `${companyId}|${titleKey}|${locationKey}`
    fingerprintByExternalId.set(externalId, fingerprint)
    fingerprintCompanyIds.push(companyId)
    fingerprintTitleKeys.push(titleKey)
    fingerprintLocationKeys.push(locationKey)
  }

  const existingAdzunaByFingerprint = new Map<string, string>()
  if (fingerprintCompanyIds.length > 0) {
    const fingerprintRows = await pool.query<{
      id: string
      company_id: string
      title_key: string
      location_key: string
    }>(
      `WITH incoming AS (
         SELECT *
           FROM unnest($1::uuid[], $2::text[], $3::text[])
             AS t(company_id, title_key, location_key)
       )
       SELECT DISTINCT ON (incoming.company_id, incoming.title_key, incoming.location_key)
              jobs.id,
              incoming.company_id::text AS company_id,
              incoming.title_key,
              incoming.location_key
         FROM incoming
         JOIN jobs
           ON jobs.company_id = incoming.company_id
          AND jobs.is_active = true
          AND jobs.closed_at IS NULL
          AND jobs.external_id ILIKE 'adzuna:%'
          AND regexp_replace(lower(coalesce(jobs.title, '')), '[^a-z0-9]+', '', 'g') = incoming.title_key
          AND regexp_replace(lower(coalesce(jobs.location, '')), '[^a-z0-9]+', '', 'g') = incoming.location_key
        ORDER BY incoming.company_id, incoming.title_key, incoming.location_key,
                 jobs.first_detected_at ASC NULLS LAST, jobs.id`,
      [fingerprintCompanyIds, fingerprintTitleKeys, fingerprintLocationKeys]
    )
    for (const row of fingerprintRows.rows) {
      existingAdzunaByFingerprint.set(`${row.company_id}|${row.title_key}|${row.location_key}`, row.id)
    }
  }

  // Upsert jobs
  const processedNewFingerprints = new Set<string>()
  const duplicateRefreshIds = new Set<string>()
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
    const fingerprint = fingerprintByExternalId.get(externalId)
    if (!existingId && fingerprint) {
      const duplicateId = existingAdzunaByFingerprint.get(fingerprint)
      if (duplicateId) {
        duplicateRefreshIds.add(duplicateId)
        stats.duplicateFingerprintSkipped++
        continue
      }
      if (processedNewFingerprints.has(fingerprint)) {
        stats.duplicateFingerprintSkipped++
        continue
      }
      processedNewFingerprints.add(fingerprint)
    }

    // Adzuna returns short snippets and zero structured metadata. Run the
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
    const basePublicationStatus = publicationStatusForNormalization(norm)
    const descLen = nc.description?.length ?? 0
    // Adzuna truncates descriptions at ~500 chars; redirect URLs are behind AWS
    // WAF so enrichment is impossible. Hide jobs that add no usable JD signal:
    //   • description < 400 chars — too short to be useful
    //   • description at the truncation ceiling with a trailing ellipsis
    //   • from a company we harvest directly — the harvested version is richer
    const likelyTruncated = isAdzunaDescriptionLikelyTruncated(nc.description)
    const redundantHarvested = harvestedCompanyIds.has(companyId)
    const hideTruncated = process.env.ADZUNA_PUBLISH_TRUNCATED !== "true"
    const publicationStatus =
      basePublicationStatus === "published" &&
      (descLen < 400 || (hideTruncated && likelyTruncated) || redundantHarvested)
        ? "hidden_low_quality"
        : basePublicationStatus
    if (publicationStatus === "hidden_low_quality" && likelyTruncated) {
      stats.truncatedHidden++
    }
    const rawData = safeJsonStringify({
      source: "adzuna",
      category: job.category,
      salaryIsPredicted: job.salaryIsPredicted,
      description_captured: Boolean(nc.description),
      description_truncated: likelyTruncated,
      description_quality: likelyTruncated
        ? "adzuna_truncated"
        : descLen < 400
          ? "too_short"
          : "snippet",
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
        // Decide the status for a brand-new Adzuna job. A would-be hidden
        // (truncated teaser) job is normally dropped — but with ENRICH_TRUNCATED
        // we persist it as 'pending_enrichment' (hidden from the feed) so the
        // enrichment cron's Playwright fallback can fetch the full JD from the
        // redirect and promote it. Jobs we already harvest directly stay dropped.
        let insertStatus: string | null = publicationStatus
        if (publicationStatus === "hidden_low_quality") {
          insertStatus = ENRICH_TRUNCATED && !redundantHarvested ? "pending_enrichment" : null
        }
        if (insertStatus === null) {
          stats.skippedHiddenInsert++
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
             nc.visa_language_detected, nc.skills, insertStatus,
             firstDetected, rawData]
          )
          if (insertStatus === "pending_enrichment") stats.insertedPendingEnrichment++
          else stats.inserted++
        }
      }
    } catch (err) {
      console.error(`[adzuna-ingest] failed to upsert job ${job.id}:`, err)
      stats.errors++
    }
  }

  if (duplicateRefreshIds.size > 0) {
    const refreshResult = await pool.query(
      `UPDATE jobs
          SET is_active = true,
              last_seen_at = NOW(),
              updated_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [[...duplicateRefreshIds]]
    )
    stats.duplicateFingerprintRefreshed = refreshResult.rowCount ?? 0
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
