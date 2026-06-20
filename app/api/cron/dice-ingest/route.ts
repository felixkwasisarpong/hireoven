/**
 * GET /api/cron/dice-ingest
 *
 * Pulls fresh jobs from the Dice.com search API and upserts them into
 * the jobs table. For each unique company name, finds an existing company
 * row or creates a lightweight placeholder so the FK is satisfied.
 *
 * Env:
 *   DICE_SEARCH_QUERIES  comma-separated list of search terms (default below)
 *   DICE_COUNTRY_CODES   comma-separated country codes (default: US,CA)
 *   DICE_POSTED_DATE     ONE_DAY_AGO | THREE_DAYS_AGO | SEVEN_DAYS_AGO (default: ONE_DAY_AGO)
 *   DICE_MAX_JOBS        max jobs per query (default: 300)
 */

import { NextRequest, NextResponse } from "next/server"
import pLimit from "p-limit"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { bumpHarvestForActiveCompanies } from "@/lib/harvester/freshness-signal"
import { enrollFromApplyUrl } from "@/lib/harvester/discovery/enroll-from-apply-url"
import {
  DiceApiError,
  searchDiceAllPages,
  parseDiceSalary,
  parseDiceWorkMode,
  fetchDiceJobDescription,
  type DiceJob,
} from "@/lib/sources/dice"
import { isValidCompanyName } from "@/lib/sources/company-name-guard"
import { normalizePersistedJobRecord } from "@/lib/jobs/normalization"
import { publicationStatusForJob } from "@/lib/jobs/publication"
import { safeJsonStringify } from "@/lib/jobs/json-sanitize"
import type { EmploymentType } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 300

// Cap per-run detail enrichments to stay under the 5-min Vercel limit.
// At pLimit(3) × ~1s per fetch, 800 ≈ 270s of network — leaves enough budget
// for the search/upsert phases. Existing rows with long descriptions are
// skipped so each run prioritises freshly-ingested or stale entries.
//
// Previously 400 — bumped after observing search batches returning 500+ new
// rows in a single tick, causing the overflow to land as summary-only until
// the next cron run.
const DICE_ENRICH_CONCURRENCY = Number(process.env.DICE_ENRICH_CONCURRENCY ?? "3")
const DICE_ENRICH_MAX_PER_RUN = Number(process.env.DICE_ENRICH_MAX_PER_RUN ?? "800")
const DICE_ENRICH_STALE_LENGTH = 800

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

function parseDiceCountryCodes(raw: string | null | undefined): string[] {
  const countryCodes = (raw ?? "US,CA")
    .split(",")
    .map((country) => country.trim().toUpperCase())
    .filter((country) => /^[A-Z]{2}$/.test(country))
  return countryCodes.length ? [...new Set(countryCodes)] : ["US", "CA"]
}

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

  const postedDate = url.searchParams.get("postedDate") ?? process.env.DICE_POSTED_DATE ?? "ONE_DAY_AGO"
  const maxJobs = Number(url.searchParams.get("maxJobs") ?? process.env.DICE_MAX_JOBS ?? "300")
  const countryOverride = url.searchParams.get("countryCode")
  const countryCodes = countryOverride
    ? parseDiceCountryCodes(countryOverride)
    : parseDiceCountryCodes(process.env.DICE_COUNTRY_CODES)

  const pool = getPostgresPool()
  const stats: Record<string, number> = {
    queries: 0, fetched: 0, inserted: 0, updated: 0, errors: 0,
    upstreamErrors: 0, providerBlocked: 0, countries: countryCodes.length,
    enrichmentAttempted: 0, enriched: 0, enrichFail: 0,
  }

  // Dedupe across queries by Dice job ID
  const seen = new Map<string, DiceJob>()
  const queryDelayMs = Number(process.env.DICE_QUERY_DELAY_MS ?? "800")

  const searchRequests = queries.flatMap((q) => countryCodes.map((countryCode) => ({ q, countryCode })))
  for (let qi = 0; qi < searchRequests.length; qi += 1) {
    const { q, countryCode } = searchRequests[qi]
    if (qi > 0 && queryDelayMs > 0) await new Promise((r) => setTimeout(r, queryDelayMs)) // pace queries under the WAF
    try {
      const jobs = await searchDiceAllPages({ q, countryCode, postedDate }, maxJobs)
      stats.queries++
      for (const job of jobs) {
        if (!seen.has(job.id) && isValidCompanyName(job.company)) seen.set(job.id, job)
      }
      stats.fetched = seen.size
    } catch (err) {
      if (err instanceof DiceApiError) {
        console.warn("[dice-ingest] query failed after retries", {
          query: q,
          countryCode,
          status: err.status,
          retryable: err.retryable,
        })
        stats.errors++
        stats.upstreamErrors++
        if (err.status === 401 || err.status === 403) {
          stats.providerBlocked++
          break
        }
      } else {
        console.error(`[dice-ingest] query "${q}" (${countryCode}) failed:`, err)
        stats.errors++
      }
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

  // Create companies for any that don't exist yet.
  // Try ATS detection from apply URL first — if the job links directly to
  // Greenhouse/Lever/Ashby/etc., create a real harvestable row instead of
  // a placeholder that discover-tenants may never resolve.
  const missing = companyNames.filter((n) => !companyIdMap.has(n))
  for (const normName of missing) {
    const jobs = byCompany.get(normName)!
    const sample = jobs[0]
    try {
      // Attempt ATS detection from the apply URL
      const enrolled = await enrollFromApplyUrl(pool, {
        companyName: sample.company,
        applyUrl: sample.applyUrl,
        source: "dice",
      })
      if (enrolled) {
        companyIdMap.set(normName, enrolled.id)
        continue
      }
      // Fall back to placeholder
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

  // Bulk-check which external_ids already exist + how long their stored
  // description is. We use the length to decide whether to spend a detail
  // fetch on enrichment.
  const allExternalIds = [...seen.values()].map((j) => `dice:${j.id}`)
  const existingRows = await pool.query<{ id: string; external_id: string; desc_len: number }>(
    `SELECT id, external_id, COALESCE(length(description), 0) AS desc_len
     FROM jobs WHERE external_id = ANY($1)`,
    [allExternalIds]
  )
  const existingByExtId = new Map(
    existingRows.rows.map((r) => [r.external_id, { id: r.id, descLen: r.desc_len }])
  )

  // Phase-2 enrichment: fetch full descriptions for net-new jobs and jobs
  // whose stored description is still summary-length. Cap per-run to keep
  // the cron under maxDuration.
  const enrichmentTargets: DiceJob[] = []
  for (const job of seen.values()) {
    const existing = existingByExtId.get(`dice:${job.id}`)
    if (!existing || existing.descLen < DICE_ENRICH_STALE_LENGTH) {
      enrichmentTargets.push(job)
      if (enrichmentTargets.length >= DICE_ENRICH_MAX_PER_RUN) break
    }
  }

  const enrichedDescriptions = new Map<string, string>()
  let enrichOk = 0
  let enrichFail = 0
  if (enrichmentTargets.length > 0) {
    const limit = pLimit(DICE_ENRICH_CONCURRENCY)
    await Promise.all(
      enrichmentTargets.map((job) =>
        limit(async () => {
          const detail = job.applyUrl.startsWith("https://www.dice.com/job-detail/")
            ? job.applyUrl
            : `https://www.dice.com/job-detail/${job.id}`
          const fullDescription = await fetchDiceJobDescription(detail)
          if (fullDescription && fullDescription.length > job.summary.length) {
            enrichedDescriptions.set(job.id, fullDescription)
            enrichOk++
          } else {
            enrichFail++
          }
        })
      )
    )
  }
  Object.assign(stats, {
    enrichmentAttempted: enrichmentTargets.length,
    enriched: enrichOk,
    enrichFail,
  })

  // Insert new + update existing
  for (const job of seen.values()) {
    const companyId = companyIdMap.get(job.company.toLowerCase().trim())
    if (!companyId) continue

    const { min: salaryMin, max: salaryMax, currency } = parseDiceSalary(job.salary)
    const { isRemote, isHybrid } = parseDiceWorkMode(job.workFromHome)
    const externalId = `dice:${job.id}`
    const employmentType = job.employmentType?.toLowerCase().replace("_", "-") ?? null
    const firstDetected = job.postedDate ? new Date(job.postedDate).toISOString() : new Date().toISOString()

    const existing = existingByExtId.get(externalId)
    // Prefer the enriched JD when we have one; otherwise fall back to the
    // search-result summary. When updating an existing row, never shrink an
    // already-longer description we may have previously enriched.
    const enriched = enrichedDescriptions.get(job.id)
    const candidateDescription = enriched ?? job.summary
    const description = existing && existing.descLen > candidateDescription.length
      ? null  // keep what's there
      : candidateDescription

    const simpleRawData = JSON.stringify({ source: "dice", diceId: job.id, workFromHome: job.workFromHome, easyApply: job.easyApply })

    try {
      if (existing && description === null) {
        // Keeping a longer existing description — refresh light fields only,
        // leave skills/publication_status as previously enriched.
        await pool.query(
          `UPDATE jobs SET
             title=$1, location=$2, is_remote=$3, is_hybrid=$4,
             employment_type=$5, salary_min=$6, salary_max=$7,
             salary_currency=$8, is_active=true,
             last_seen_at=NOW(), updated_at=NOW(), raw_data=$9
           WHERE id=$10`,
          [job.title, job.location, isRemote, isHybrid, employmentType,
           salaryMin ?? null, salaryMax ?? null, currency,
           simpleRawData, existing.id]
        )
        stats.updated++
      } else {
        // Writing a description — run the deterministic normalizer (same one
        // the harvester/adzuna path uses) so dice tech jobs get skills,
        // seniority, normalized title, etc. Dice previously persisted no skills
        // at all → every dice job sat at 0% coverage.
        const norm = normalizePersistedJobRecord({
          id: existing?.id ?? "",
          title: job.title,
          normalized_title: null,
          location: job.location,
          apply_url: job.applyUrl,
          external_id: externalId,
          description: candidateDescription || null,
          employment_type: employmentType as EmploymentType | null,
          seniority_level: null,
          is_remote: isRemote,
          is_hybrid: isHybrid,
          salary_min: salaryMin ?? null,
          salary_max: salaryMax ?? null,
          salary_currency: currency ?? "USD",
          sponsors_h1b: null,
          sponsorship_score: 0,
          requires_authorization: false,
          visa_language_detected: null,
          skills: [],
          first_detected_at: firstDetected,
          raw_data: { source: "dice", diceId: job.id, workFromHome: job.workFromHome, easyApply: job.easyApply },
        })
        const nc = norm.nextColumns
        const publicationStatus = publicationStatusForJob({ description: nc.description, skills: nc.skills })
        const richRawData = safeJsonStringify({
          source: "dice",
          diceId: job.id,
          workFromHome: job.workFromHome,
          easyApply: job.easyApply,
          normalized: norm.canonical,
          structured_job: norm.structuredData,
          view: { page: norm.pageView, card: norm.cardView },
        })

        if (existing) {
          await pool.query(
            `UPDATE jobs SET
               title=$1, normalized_title=$2, location=$3, is_remote=$4, is_hybrid=$5,
               employment_type=$6, seniority_level=$7, description=$8,
               salary_min=$9, salary_max=$10, salary_currency=$11,
               skills=$12, publication_status=$13, is_active=true,
               last_seen_at=NOW(), updated_at=NOW(), raw_data=$14
             WHERE id=$15`,
            [job.title, nc.normalized_title, nc.location, nc.is_remote, nc.is_hybrid,
             nc.employment_type, nc.seniority_level, nc.description,
             nc.salary_min, nc.salary_max, nc.salary_currency ?? "USD",
             nc.skills, publicationStatus, richRawData, existing.id]
          )
          stats.updated++
        } else {
          await pool.query(
            `INSERT INTO jobs (
               company_id, title, normalized_title, location, is_remote, is_hybrid,
               employment_type, seniority_level, description, apply_url, external_id,
               salary_min, salary_max, salary_currency,
               skills, publication_status,
               is_active, last_seen_at, first_detected_at,
               created_at, updated_at, raw_data
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               true, NOW(), $17, NOW(), NOW(), $18
             )`,
            [companyId, job.title, nc.normalized_title, nc.location, nc.is_remote, nc.is_hybrid,
             nc.employment_type, nc.seniority_level, nc.description, job.applyUrl, externalId,
             nc.salary_min, nc.salary_max, nc.salary_currency ?? "USD",
             nc.skills, publicationStatus,
             firstDetected, richRawData]
          )
          stats.inserted++
        }
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

  // Freshness loop: a company on Dice today is actively hiring — pull its real
  // ATS board's next harvest forward so we catch the original posting fast.
  try {
    stats.harvestBumped = await bumpHarvestForActiveCompanies(pool, [...companyIdMap.values()])
  } catch (err) {
    console.error("[dice-ingest] harvest bump failed:", err)
  }

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
