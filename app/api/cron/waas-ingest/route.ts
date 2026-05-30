/**
 * GET /api/cron/waas-ingest
 *
 * Pulls fresh jobs from Y Combinator's Work at a Startup (workatastartup.com).
 *
 *   1. Fans out across WAAS_ROLE_SLUGS, collecting summaries (~30/role).
 *   2. Dedupes by WAAS job id.
 *   3. For each unique job, fetches the detail page for descriptionHtml + skills.
 *   4. Resolves or creates a placeholder company row (by name + slug).
 *   5. Upserts the job with external_id `waas:{id}`.
 *
 * Env / query overrides:
 *   WAAS_INGEST_CONCURRENCY  detail-fetch concurrency (default 3)
 *   ?role=software-engineer  restrict to a single role for ad-hoc runs
 *   ?maxDetails=N            cap total detail fetches per run (default 600)
 */

import { NextRequest, NextResponse } from "next/server"
import pLimit from "p-limit"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { bumpHarvestForActiveCompanies } from "@/lib/harvester/freshness-signal"
import {
  WAAS_ROLE_SLUGS,
  fetchWaasJobDetail,
  fetchWaasListing,
  htmlToPlainText,
  parseWaasSalary,
  parseWaasSponsorship,
  parseWaasWorkMode,
  type WaasJobSummary,
  type WaasRoleSlug,
} from "@/lib/sources/workatastartup"

export const runtime = "nodejs"
export const maxDuration = 300

const WAAS_INGEST_CONCURRENCY = Number(process.env.WAAS_INGEST_CONCURRENCY ?? "3")
const WAAS_INGEST_MAX_DETAILS_DEFAULT = 600
const WAAS_INGEST_STALE_LENGTH = 800

function placeholderDomain(slug: string): string {
  return `waas-${slug.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40)}.placeholder`
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const roleOverride = url.searchParams.get("role") as WaasRoleSlug | null
  const maxDetails = Math.max(
    1,
    Number.parseInt(
      url.searchParams.get("maxDetails") ??
        process.env.WAAS_INGEST_MAX_DETAILS ??
        String(WAAS_INGEST_MAX_DETAILS_DEFAULT),
      10
    )
  )

  const roles = roleOverride
    ? [roleOverride]
    : ([...WAAS_ROLE_SLUGS] as WaasRoleSlug[])

  const pool = getPostgresPool()
  const stats: Record<string, number> = {
    rolesQueried: 0,
    fetched: 0,
    detailsFetched: 0,
    detailsFailed: 0,
    inserted: 0,
    updated: 0,
    skippedNoCompany: 0,
    errors: 0,
  }

  // ── Phase 1: fan-out across roles, dedupe by job id ──
  const seen = new Map<number, WaasJobSummary>()
  for (const role of roles) {
    try {
      const summaries = await fetchWaasListing(role)
      stats.rolesQueried += 1
      for (const summary of summaries) {
        if (!seen.has(summary.id)) seen.set(summary.id, summary)
      }
    } catch (err) {
      console.error(`[waas-ingest] role "${role}" failed:`, err)
      stats.errors += 1
    }
  }
  stats.fetched = seen.size

  if (seen.size === 0) {
    return NextResponse.json({ ...stats, message: "No jobs fetched" })
  }

  // ── Phase 2: resolve / create companies in bulk ──
  // Group jobs by lowercased company name (same dedupe pattern as Dice).
  const byCompany = new Map<string, WaasJobSummary[]>()
  for (const job of seen.values()) {
    const key = job.companyName.toLowerCase().trim()
    if (!byCompany.has(key)) byCompany.set(key, [])
    byCompany.get(key)!.push(job)
  }
  const companyNames = [...byCompany.keys()]

  const companyIdMap = new Map<string, string>()
  if (companyNames.length > 0) {
    const existingResult = await pool.query<{ id: string; name: string }>(
      `SELECT id, LOWER(TRIM(name)) AS name
       FROM companies
       WHERE LOWER(TRIM(name)) = ANY($1::text[])`,
      [companyNames]
    )
    for (const row of existingResult.rows) {
      companyIdMap.set(row.name, row.id)
    }
  }

  const missingCompanyNames = companyNames.filter((n) => !companyIdMap.has(n))
  for (const normName of missingCompanyNames) {
    const jobs = byCompany.get(normName)!
    const sample = jobs[0]
    const domain = placeholderDomain(sample.companySlug)
    const careersUrl = `https://www.workatastartup.com/companies/${encodeURIComponent(sample.companySlug)}`
    try {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO companies (name, domain, careers_url, logo_url, is_active, raw_ats_config)
         VALUES ($1, $2, $3, $4, false, $5)
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          sample.companyName,
          domain,
          careersUrl,
          sample.companyLogoUrl,
          JSON.stringify({
            source: "waas",
            yc_batch: sample.companyBatch,
            yc_slug: sample.companySlug,
            crawl_allowed: false,
          }),
        ]
      )
      if (res.rows[0]) companyIdMap.set(normName, res.rows[0].id)
    } catch (err) {
      console.error(`[waas-ingest] company upsert failed for "${normName}":`, err)
    }
  }

  // ── Phase 3: existing-job lookup so we can skip detail-fetches when
  // the stored description is already adequate. ──
  const allExternalIds = [...seen.keys()].map((id) => `waas:${id}`)
  const existingRows = await pool.query<{ id: string; external_id: string; desc_len: number }>(
    `SELECT id, external_id, COALESCE(length(description), 0) AS desc_len
     FROM jobs WHERE external_id = ANY($1::text[])`,
    [allExternalIds]
  )
  const existingByExtId = new Map(
    existingRows.rows.map((r) => [r.external_id, { id: r.id, descLen: r.desc_len }])
  )

  // ── Phase 4: detail enrichment for new + stale rows ──
  const detailTargets: WaasJobSummary[] = []
  for (const job of seen.values()) {
    const existing = existingByExtId.get(`waas:${job.id}`)
    if (!existing || existing.descLen < WAAS_INGEST_STALE_LENGTH) {
      detailTargets.push(job)
      if (detailTargets.length >= maxDetails) break
    }
  }

  const detailsById = new Map<number, Awaited<ReturnType<typeof fetchWaasJobDetail>>>()
  let detailsFetched = 0
  let detailsFailed = 0
  if (detailTargets.length > 0) {
    const limit = pLimit(WAAS_INGEST_CONCURRENCY)
    await Promise.all(
      detailTargets.map((job) =>
        limit(async () => {
          const detail = await fetchWaasJobDetail(job.id)
          if (detail) {
            detailsById.set(job.id, detail)
            detailsFetched += 1
          } else {
            detailsFailed += 1
          }
        })
      )
    )
  }
  stats.detailsFetched = detailsFetched
  stats.detailsFailed = detailsFailed

  // ── Phase 5: upsert jobs ──
  for (const job of seen.values()) {
    const companyId = companyIdMap.get(job.companyName.toLowerCase().trim())
    if (!companyId) {
      stats.skippedNoCompany += 1
      continue
    }

    const detail = detailsById.get(job.id) ?? null
    const description = htmlToPlainText(detail?.job?.descriptionHtml ?? null)
    const skills = detail?.job?.skills ?? null
    const employmentType =
      (detail?.job?.jobType ?? job.jobType)?.toLowerCase().replace(/\s+/g, "-") ?? null
    const sponsorsH1B = parseWaasSponsorship(detail?.job?.sponsorsVisa)

    // Use the detail-page salary fields when available, otherwise fall back
    // to the listing's free-form `salary` string.
    const salaryParsed =
      detail?.job?.salaryRange != null
        ? parseWaasSalary(detail.job.salaryRange)
        : parseWaasSalary(job.salary)

    const { isRemote, isHybrid } = parseWaasWorkMode(detail?.job?.location ?? job.location)
    const externalId = `waas:${job.id}`
    const applyUrl = detail?.applyUrl ?? job.applyUrl
    const rawData = JSON.stringify({
      source: "waas",
      waasId: job.id,
      ycBatch: job.companyBatch,
      ycCompanySlug: job.companySlug,
      detailUrl: `https://www.workatastartup.com/jobs/${job.id}`,
      minExperience: detail?.job?.minExperience ?? null,
      equityRange: detail?.job?.equityRange ?? null,
    })

    const existing = existingByExtId.get(externalId)
    // Never shrink a stored description with a shorter one.
    const candidateDescription = description.length > 0 ? description : null
    const descriptionToWrite =
      existing && candidateDescription && existing.descLen >= candidateDescription.length
        ? null // keep what's already there
        : candidateDescription

    try {
      if (existing) {
        if (descriptionToWrite === null) {
          await pool.query(
            `UPDATE jobs SET
               title=$1, location=$2, is_remote=$3, is_hybrid=$4,
               employment_type=$5, salary_min=$6, salary_max=$7,
               salary_currency=$8, sponsors_h1b=$9, skills=$10,
               apply_url=$11, is_active=true,
               last_seen_at=NOW(), updated_at=NOW(), raw_data=$12
             WHERE id=$13`,
            [
              detail?.job?.title ?? job.title,
              detail?.job?.location ?? job.location,
              isRemote,
              isHybrid,
              employmentType,
              salaryParsed.min,
              salaryParsed.max,
              salaryParsed.currency,
              sponsorsH1B,
              skills,
              applyUrl,
              rawData,
              existing.id,
            ]
          )
        } else {
          await pool.query(
            `UPDATE jobs SET
               title=$1, location=$2, is_remote=$3, is_hybrid=$4,
               employment_type=$5, description=$6, salary_min=$7,
               salary_max=$8, salary_currency=$9, sponsors_h1b=$10,
               skills=$11, apply_url=$12, is_active=true,
               last_seen_at=NOW(), updated_at=NOW(), raw_data=$13
             WHERE id=$14`,
            [
              detail?.job?.title ?? job.title,
              detail?.job?.location ?? job.location,
              isRemote,
              isHybrid,
              employmentType,
              descriptionToWrite,
              salaryParsed.min,
              salaryParsed.max,
              salaryParsed.currency,
              sponsorsH1B,
              skills,
              applyUrl,
              rawData,
              existing.id,
            ]
          )
        }
        stats.updated += 1
      } else {
        await pool.query(
          `INSERT INTO jobs (
             company_id, title, location, is_remote, is_hybrid,
             employment_type, description, apply_url, external_id,
             salary_min, salary_max, salary_currency,
             sponsors_h1b, skills,
             is_active, last_seen_at, first_detected_at,
             created_at, updated_at, raw_data
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             true, NOW(), NOW(), NOW(), NOW(), $15
           )`,
          [
            companyId,
            detail?.job?.title ?? job.title,
            detail?.job?.location ?? job.location,
            isRemote,
            isHybrid,
            employmentType,
            descriptionToWrite ?? "",
            applyUrl,
            externalId,
            salaryParsed.min,
            salaryParsed.max,
            salaryParsed.currency,
            sponsorsH1B,
            skills,
            rawData,
          ]
        )
        stats.inserted += 1
      }
    } catch (err) {
      console.error(`[waas-ingest] upsert failed for waas:${job.id}:`, err)
      stats.errors += 1
    }
  }

  // Refresh job_count on every touched company.
  if (companyIdMap.size > 0) {
    await pool.query(
      `UPDATE companies c
       SET job_count = (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.is_active = true)
       WHERE c.id = ANY($1::uuid[])`,
      [[...companyIdMap.values()]]
    )
  }

  // Freshness loop: pull the real ATS board's next harvest forward for any
  // already-tracked company that just showed fresh WAAS activity.
  try {
    stats.harvestBumped = await bumpHarvestForActiveCompanies(pool, [...companyIdMap.values()])
  } catch (err) {
    console.error("[waas-ingest] harvest bump failed:", err)
  }

  return NextResponse.json({ ok: true, ...stats })
}
