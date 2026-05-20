/**
 * One-shot backfill: fetch real job descriptions for existing Workday jobs
 * that currently have empty, short, or flattened descriptions.
 *
 *   npx tsx scripts/backfill-workday-descriptions.ts                          # dry-run
 *   npx tsx scripts/backfill-workday-descriptions.ts --execute
 *   npx tsx scripts/backfill-workday-descriptions.ts --execute --limit=5000
 *   npx tsx scripts/backfill-workday-descriptions.ts --execute --min-length=300
 *   npx tsx scripts/backfill-workday-descriptions.ts --execute --include-flattened
 *   npx tsx scripts/backfill-workday-descriptions.ts --execute --job-id=<uuid>
 *
 * For each selected Workday job:
 *   1. Derive the {tenant}:{wd}:{site} triplet from the company's careers_url
 *   2. Extract the `externalPath` from the job's apply_url
 *   3. GET the per-job detail endpoint
 *   4. UPDATE description, normalized fields, raw_data view/structured_job, and content_hash
 *
 * Use --limit to bound a single run. `--include-flattened` repairs the long
 * one-line Workday descriptions produced before the structured HTML fix.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { workdayAdapter, fetchWorkdayJobDetail } from "@/lib/harvester/adapters/workday"
import { hashContent } from "@/lib/harvester/adapters/_base"
import { normalizeCrawlerJobForPersistence } from "@/lib/jobs/normalization"
import { getPostgresPool } from "@/lib/postgres/server"
import type { EmploymentType, SeniorityLevel } from "@/types"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "1000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "6", 10))
const minLength = Math.max(0, Number.parseInt(getArg("--min-length=") ?? "300", 10))
const includeFlattened = args.includes("--include-flattened") || args.includes("--force")
const force = args.includes("--force")
const jobId = getArg("--job-id=")

const WORKDAY_HOST_RE = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/i

type CandidateRow = {
  job_id: string
  job_title: string
  job_apply_url: string
  job_location: string | null
  job_posted_at: string | null
  job_description: string | null
  job_external_id: string | null
  employment_type: EmploymentType | null
  seniority_level: SeniorityLevel | null
  is_remote: boolean | null
  is_hybrid: boolean | null
  requires_authorization: boolean | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  visa_language_detected: string | null
  raw_data: Record<string, unknown> | null
  company_name: string | null
  company_domain: string | null
  company_careers_url: string
  company_ats_identifier: string | null
}

async function loadCandidates(): Promise<CandidateRow[]> {
  const pool = getPostgresPool()
  const params: Array<string | number | boolean> = [limit]
  const where = [
    "j.source_ats = 'workday'",
    "j.is_active = true",
    "j.closed_at IS NULL",
    "c.careers_url IS NOT NULL",
  ]

  if (jobId) {
    params.push(jobId)
    where.push(`j.id = $${params.length}::uuid`)
  } else if (!force) {
    params.push(minLength)
    const minLengthParam = params.length
    params.push(includeFlattened)
    where.push(
      `(j.description IS NULL OR length(j.description) < $${minLengthParam} OR ($${params.length}::boolean AND position(E'\n' in j.description) = 0))`
    )
  }

  const { rows } = await pool.query<CandidateRow>(
    `SELECT j.id          AS job_id,
            j.title       AS job_title,
            j.apply_url   AS job_apply_url,
            j.location    AS job_location,
            j.posted_at   AS job_posted_at,
            j.description AS job_description,
            j.external_id AS job_external_id,
            j.employment_type,
            j.seniority_level,
            j.is_remote,
            j.is_hybrid,
            j.requires_authorization,
            j.salary_min,
            j.salary_max,
            j.salary_currency,
            j.sponsors_h1b,
            j.sponsorship_score,
            j.visa_language_detected,
            j.raw_data,
            c.name        AS company_name,
            c.domain      AS company_domain,
            c.careers_url AS company_careers_url,
            c.ats_identifier AS company_ats_identifier
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
      WHERE ${where.join("\n        AND ")}
      ORDER BY j.first_detected_at DESC NULLS LAST
      LIMIT $1`,
    params
  )
  return rows
}

/**
 * Parse the company row to a Workday ParsedSlug. Prefers the canonical
 * ats_identifier triplet (set by backfill-workday-ats-identifier.ts); falls
 * back to detecting from careers_url.
 */
function parseCompanySlug(row: CandidateRow): { tenant: string; wd: string; site: string } | null {
  const ident = row.company_ats_identifier?.trim() ?? ""
  if (ident && /^[a-zA-Z0-9-]+:wd[0-9]+:[A-Za-z0-9_-]+$/.test(ident)) {
    const [tenant, wd, site] = ident.split(":")
    return { tenant, wd, site }
  }
  // Fall back to URL parsing.
  const detected = workdayAdapter.detectFromUrl(row.company_careers_url)
  if (detected) {
    const [tenant, wd, site] = detected.slug.split(":")
    return { tenant, wd, site }
  }
  return null
}

/**
 * Extract the Workday `externalPath` from a job apply URL of the form
 *   https://{tenant}.{wd}.myworkdayjobs.com/{locale}/{site}/job/Location/Title_R12345
 * The externalPath is `/job/Location/Title_R12345`.
 */
function extractExternalPath(applyUrl: string, parsed: { tenant: string; wd: string; site: string }): string | null {
  let u: URL
  try {
    u = new URL(applyUrl)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  const m = host.match(WORKDAY_HOST_RE)
  if (!m) return null
  // Pathname: /{locale}?/{site}/{externalPath...}
  const parts = u.pathname.split("/").filter(Boolean)
  // Find the index of the site segment
  const siteIdx = parts.findIndex(
    (p) => p.toLowerCase() === parsed.site.toLowerCase()
  )
  if (siteIdx < 0 || siteIdx >= parts.length - 1) return null
  return "/" + parts.slice(siteIdx + 1).join("/")
}

function hasStructuredDescription(value: string | null | undefined): boolean {
  if (!value) return false
  return /(?:^|\n)\s*[-•]\s+\S/.test(value) || /(?:^|\n)[A-Z][A-Za-z /&()'-]{2,80}:\s*(?:\n|$)/.test(value)
}

function shouldUpdateDescription(currentDescription: string | null, newDescription: string | undefined): boolean {
  if (!newDescription) return false
  if (!currentDescription) return true
  if (newDescription.length > currentDescription.length + 20) return true
  return (
    !hasStructuredDescription(currentDescription) &&
    hasStructuredDescription(newDescription) &&
    newDescription.length >= currentDescription.length * 0.8
  )
}

async function main() {
  console.log(
    `[backfill-workday-descriptions] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency} min-length=${minLength} include_flattened=${includeFlattened ? "yes" : "no"} force=${force ? "yes" : "no"} job_id=${jobId ?? "none"}`
  )

  const candidates = await loadCandidates()
  console.log(`[backfill-workday-descriptions] loaded ${candidates.length} candidates`)

  let enriched = 0
  let skippedNoSlug = 0
  let skippedNoExternalPath = 0
  let fetchFailed = 0
  let unchanged = 0
  let updated = 0

  const limiter = pLimit(concurrency)
  const pool = getPostgresPool()

  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        const slug = parseCompanySlug(row)
        if (!slug) {
          skippedNoSlug += 1
          return
        }
        const externalPath = extractExternalPath(row.job_apply_url, slug)
        if (!externalPath) {
          skippedNoExternalPath += 1
          return
        }
        const detail = await fetchWorkdayJobDetail(slug, externalPath, {
          etag: null,
          lastModified: null,
        })
        if (!detail) {
          fetchFailed += 1
          return
        }
        const newDescription = detail.description
        if (!newDescription) {
          unchanged += 1
          return
        }
        if (!force && !shouldUpdateDescription(row.job_description, newDescription)) {
          unchanged += 1
          return
        }
        enriched += 1

        if (dryRun) return

        const newLocation = row.job_location ?? detail.location ?? null
        const nowIso = new Date().toISOString()
        const normalization = normalizeCrawlerJobForPersistence({
          rawJob: {
            externalId: row.job_external_id ?? undefined,
            title: row.job_title,
            url: row.job_apply_url,
            description: newDescription,
            location: newLocation ?? undefined,
            postedAt: row.job_posted_at ?? undefined,
            company: row.company_name,
            companyDomain: row.company_domain,
          },
          crawledAtIso: nowIso,
          existing: {
            description: row.job_description,
            employment_type: row.employment_type,
            seniority_level: row.seniority_level,
            is_remote: row.is_remote,
            is_hybrid: row.is_hybrid,
            requires_authorization: row.requires_authorization,
            salary_min: row.salary_min,
            salary_max: row.salary_max,
            salary_currency: row.salary_currency,
            sponsors_h1b: row.sponsors_h1b,
            sponsorship_score: row.sponsorship_score,
            visa_language_detected: row.visa_language_detected,
          },
        })
        const nextRawData = {
          ...(row.raw_data ?? {}),
          description_backfilled_at: nowIso,
          description_source: "workday_cxs_detail",
          normalization: {
            version: normalization.canonical.schema_version,
            normalized_at: normalization.canonical.normalized_at,
            confidence_score: normalization.canonical.validation.confidence_score,
            completeness_score: normalization.canonical.validation.completeness_score,
            requires_review: normalization.canonical.validation.requires_review,
            issues: normalization.canonical.validation.issues,
          },
          normalized: normalization.canonical,
          structured_job: normalization.structuredData,
          view: {
            page: normalization.pageView,
            card: normalization.cardView,
          },
        }
        const contentHash = hashContent([
          row.job_title,
          row.job_apply_url,
          newLocation,
          row.job_posted_at,
          newDescription.slice(0, 4_000),
        ])
        await pool.query(
          `UPDATE jobs
              SET normalized_title = $2,
                  description = $3,
                  location = COALESCE(location, $4),
                  employment_type = $5,
                  seniority_level = $6,
                  is_remote = $7,
                  is_hybrid = $8,
                  salary_min = $9,
                  salary_max = $10,
                  salary_currency = $11,
                  sponsors_h1b = $12,
                  sponsorship_score = $13,
                  requires_authorization = $14,
                  visa_language_detected = $15,
                  skills = $16,
                  raw_data = $17::jsonb,
                  content_hash = decode($18, 'hex'),
                  updated_at = now()
            WHERE id = $1`,
          [
            row.job_id,
            normalization.nextColumns.normalized_title,
            normalization.nextColumns.description ?? newDescription,
            newLocation,
            normalization.nextColumns.employment_type,
            normalization.nextColumns.seniority_level,
            normalization.nextColumns.is_remote,
            normalization.nextColumns.is_hybrid,
            normalization.nextColumns.salary_min,
            normalization.nextColumns.salary_max,
            normalization.nextColumns.salary_currency,
            normalization.nextColumns.sponsors_h1b,
            normalization.nextColumns.sponsorship_score,
            normalization.nextColumns.requires_authorization,
            normalization.nextColumns.visa_language_detected,
            normalization.nextColumns.skills,
            JSON.stringify(nextRawData),
            contentHash,
          ]
        )
        updated += 1
      })
    )
  )

  console.log(
    `[backfill-workday-descriptions] enriched=${enriched} updated=${updated} unchanged=${unchanged} fetchFailed=${fetchFailed} skippedNoSlug=${skippedNoSlug} skippedNoExternalPath=${skippedNoExternalPath}`
  )
  await pool.end()
}

main().catch((error) => {
  console.error("[backfill-workday-descriptions] fatal:", error)
  process.exit(1)
})
