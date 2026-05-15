import type { Pool, PoolClient } from "pg"
import { isAllowedLocation } from "@/lib/jobs/location-filter"
import { isBlockedApplyUrl, isBlockedCrawlTitle } from "@/lib/jobs/filters"
import { normalizeCrawlerJobForPersistence } from "@/lib/jobs/normalization"
import type { HarvestedJob } from "@/lib/harvester/adapters"

/**
 * Anything that exposes pg's parameterised `query()`. Both `Pool` and
 * `PoolClient` satisfy this — letting callers pass a client mid-transaction
 * (e.g. the bench's BEGIN/ROLLBACK throughput probe) without changing
 * persistence behavior.
 */
export type DbExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">

export type BulkPersistInput = {
  pool: DbExecutor
  companyId: string
  companyMeta: {
    name: string | null
    domain: string | null
    careersUrl: string | null
  }
  sourceAts: string
  sourceAtsSlug: string
  crawledAt: Date
  jobs: HarvestedJob[]
}

export type BulkPersistOutcome = {
  inserted: number
  updated: number
  unchanged: number
  written: number
  inputCount: number
  filteredOut: number
}

type RawDataPayload = {
  source: "harvester"
  adapter: string
  raw: {
    title: string
    url: string
    description: string | null
    location: string | null
    posted_at: string | null
    external_id: string
  }
  normalization: {
    version: string
    normalized_at: string
    confidence_score: number
    completeness_score: number
    requires_review: boolean
    issues: unknown[]
  }
  normalized: unknown
  structured_job: unknown
  view: {
    page: unknown
    card: unknown
  }
}

type PersistRow = {
  external_id: string
  title: string
  normalized_title: string | null
  apply_url: string
  location: string | null
  description: string | null
  employment_type: string | null
  seniority_level: string | null
  is_remote: boolean
  is_hybrid: boolean
  requires_authorization: boolean
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  skills: string[]
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  visa_language_detected: string | null
  posted_at: string | null
  content_hash: string
  raw_data: RawDataPayload
}

function normalizePostedAtForPersist(
  rawPostedAt: string | null | undefined,
  crawledAtIso: string
): string | null {
  const raw = rawPostedAt?.trim()
  if (!raw) return null

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()

  const lower = raw.toLowerCase()
  const crawledMs = Date.parse(crawledAtIso)
  const baseMs = Number.isNaN(crawledMs) ? Date.now() : crawledMs

  if (lower === "posted today" || lower === "today") {
    return new Date(baseMs).toISOString()
  }
  if (lower === "posted yesterday" || lower === "yesterday") {
    return new Date(baseMs - 86_400_000).toISOString()
  }

  const daysAgoMatch = lower.match(/^(?:posted\s+)?(\d+)\+?\s+days?\s+ago$/)
  if (daysAgoMatch) {
    const days = Number.parseInt(daysAgoMatch[1], 10)
    if (Number.isFinite(days) && days >= 0) {
      return new Date(baseMs - days * 86_400_000).toISOString()
    }
  }

  const hoursAgoMatch = lower.match(/^(?:posted\s+)?(\d+)\+?\s+hours?\s+ago$/)
  if (hoursAgoMatch) {
    const hours = Number.parseInt(hoursAgoMatch[1], 10)
    if (Number.isFinite(hours) && hours >= 0) {
      return new Date(baseMs - hours * 3_600_000).toISOString()
    }
  }

  return null
}

const UPSERT_SQL = `
INSERT INTO jobs (
  company_id, external_id, title, normalized_title, apply_url, location, description,
  employment_type, seniority_level, is_remote, is_hybrid, requires_authorization,
  salary_min, salary_max, salary_currency, skills, sponsors_h1b, sponsorship_score,
  visa_language_detected, is_active, last_seen_at, posted_at, content_hash, source_ats,
  source_ats_slug, raw_data, first_detected_at, created_at, updated_at, closed_at
)
SELECT
  $1::uuid                                                                      AS company_id,
  v->>'external_id'                                                             AS external_id,
  v->>'title'                                                                   AS title,
  v->>'normalized_title'                                                        AS normalized_title,
  v->>'apply_url'                                                               AS apply_url,
  v->>'location'                                                                AS location,
  v->>'description'                                                             AS description,
  v->>'employment_type'                                                         AS employment_type,
  v->>'seniority_level'                                                         AS seniority_level,
  COALESCE((v->>'is_remote')::boolean, false)                                   AS is_remote,
  COALESCE((v->>'is_hybrid')::boolean, false)                                   AS is_hybrid,
  COALESCE((v->>'requires_authorization')::boolean, false)                      AS requires_authorization,
  NULLIF(v->>'salary_min','')::integer                                          AS salary_min,
  NULLIF(v->>'salary_max','')::integer                                          AS salary_max,
  v->>'salary_currency'                                                         AS salary_currency,
  (SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(v->'skills', '[]'::jsonb)) x) AS skills,
  NULLIF(v->>'sponsors_h1b','')::boolean                                        AS sponsors_h1b,
  NULLIF(v->>'sponsorship_score','')::integer                                   AS sponsorship_score,
  v->>'visa_language_detected'                                                  AS visa_language_detected,
  true                                                                          AS is_active,
  $2::timestamptz                                                               AS last_seen_at,
  NULLIF(v->>'posted_at','')::timestamptz                                       AS posted_at,
  decode(v->>'content_hash', 'hex')                                             AS content_hash,
  $3                                                                            AS source_ats,
  $4                                                                            AS source_ats_slug,
  v->'raw_data'                                                                 AS raw_data,
  COALESCE(NULLIF(v->>'posted_at','')::timestamptz, $2::timestamptz)             AS first_detected_at,
  $2::timestamptz                                                               AS created_at,
  $2::timestamptz                                                               AS updated_at,
  NULL::timestamptz                                                             AS closed_at
FROM jsonb_array_elements($5::jsonb) AS v
ON CONFLICT (company_id, external_id) WHERE external_id IS NOT NULL AND company_id IS NOT NULL
DO UPDATE SET
  title                  = EXCLUDED.title,
  normalized_title       = EXCLUDED.normalized_title,
  apply_url              = EXCLUDED.apply_url,
  location               = EXCLUDED.location,
  description            = EXCLUDED.description,
  employment_type        = EXCLUDED.employment_type,
  seniority_level        = EXCLUDED.seniority_level,
  is_remote              = EXCLUDED.is_remote,
  is_hybrid              = EXCLUDED.is_hybrid,
  requires_authorization = EXCLUDED.requires_authorization,
  salary_min             = EXCLUDED.salary_min,
  salary_max             = EXCLUDED.salary_max,
  salary_currency        = EXCLUDED.salary_currency,
  skills                 = EXCLUDED.skills,
  sponsors_h1b           = EXCLUDED.sponsors_h1b,
  sponsorship_score      = EXCLUDED.sponsorship_score,
  visa_language_detected = EXCLUDED.visa_language_detected,
  is_active              = true,
  last_seen_at           = EXCLUDED.last_seen_at,
  posted_at              = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
  content_hash           = EXCLUDED.content_hash,
  source_ats             = EXCLUDED.source_ats,
  source_ats_slug        = EXCLUDED.source_ats_slug,
  raw_data               = EXCLUDED.raw_data,
  closed_at              = NULL,
  updated_at             = EXCLUDED.updated_at
WHERE jobs.content_hash IS DISTINCT FROM EXCLUDED.content_hash
RETURNING (xmax = 0) AS inserted
`

function buildPersistRow(args: {
  job: HarvestedJob
  companyMeta: BulkPersistInput["companyMeta"]
  crawledAtIso: string
}): PersistRow | null {
  const { job, companyMeta, crawledAtIso } = args
  const normalizedPostedAt = normalizePostedAtForPersist(job.postedAt, crawledAtIso)

  const normalization = normalizeCrawlerJobForPersistence({
    rawJob: {
      externalId: job.externalId,
      title: job.title,
      url: job.applyUrl,
      description: job.description,
      location: job.location,
      postedAt: job.postedAt,
      company: companyMeta.name,
      companyDomain: companyMeta.domain,
      companyLogo: null,
      workMode: job.workMode ?? null,
      employmentType: job.employmentType ?? null,
      salaryRange: null,
      salaryMin: job.salaryMin ?? null,
      salaryMax: job.salaryMax ?? null,
      salaryCurrency: job.salaryCurrency ?? null,
      matchScore: null,
      matchLabel: null,
      matchedSkills: null,
      missingSkills: null,
      sponsorshipSignal: null,
      companySummary: null,
      companyFoundedYear: null,
      companyEmployeeCount: null,
      companyIndustry: null,
      easyApply: null,
      activelyHiring: null,
      topApplicantSignal: null,
      companyVerified: null,
    },
    crawledAtIso,
    existing: {
      description: null,
      employment_type: null,
      seniority_level: null,
      is_remote: null,
      is_hybrid: null,
      requires_authorization: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      sponsors_h1b: null,
      sponsorship_score: null,
      visa_language_detected: null,
    },
  })

  const cols = normalization.nextColumns

  const rawData: RawDataPayload = {
    source: "harvester",
    adapter: normalization.canonical.source.adapter,
    raw: {
      title: job.title,
      url: job.applyUrl,
      description: job.description ?? null,
      location: job.location ?? null,
      posted_at: job.postedAt ?? null,
      external_id: job.externalId,
    },
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
    view: { page: normalization.pageView, card: normalization.cardView },
  }

  return {
    external_id: job.externalId,
    title: job.title.trim(),
    normalized_title: cols.normalized_title ?? null,
    apply_url: job.applyUrl,
    location: cols.location ?? null,
    description: cols.description ?? null,
    employment_type: cols.employment_type ?? null,
    seniority_level: cols.seniority_level ?? null,
    is_remote: Boolean(cols.is_remote),
    is_hybrid: Boolean(cols.is_hybrid),
    requires_authorization: Boolean(cols.requires_authorization),
    salary_min: cols.salary_min ?? null,
    salary_max: cols.salary_max ?? null,
    salary_currency: cols.salary_currency ?? null,
    skills: cols.skills ?? [],
    sponsors_h1b: cols.sponsors_h1b ?? null,
    sponsorship_score: cols.sponsorship_score ?? null,
    visa_language_detected: cols.visa_language_detected ?? null,
    posted_at: normalizedPostedAt,
    content_hash: job.contentHash,
    raw_data: rawData,
  }
}

async function updateCompanyJobCount(
  pool: DbExecutor,
  companyId: string,
  crawledAtIso: string
): Promise<void> {
  await pool.query(
    `UPDATE companies
     SET job_count = (SELECT COUNT(*) FROM jobs WHERE company_id = $1 AND is_active = true),
         last_crawled_at = $2::timestamptz,
         updated_at = $2::timestamptz
     WHERE id = $1`,
    [companyId, crawledAtIso]
  )
}

export async function persistJobsBulk(
  input: BulkPersistInput
): Promise<BulkPersistOutcome> {
  const { pool, companyId, companyMeta, sourceAts, sourceAtsSlug, crawledAt, jobs } = input
  const crawledAtIso = crawledAt.toISOString()
  const inputCount = jobs.length

  // Filter blocked titles, blocked URLs, and disallowed locations.
  const filtered = jobs.filter((job) => {
    if (isBlockedCrawlTitle(job.title)) return false
    if (isBlockedApplyUrl(job.applyUrl)) return false
    if (!isAllowedLocation({ location: job.location, workMode: job.workMode })) return false
    return true
  })

  // Dedupe within the run (keep latest payload per external_id).
  const dedupedMap = new Map<string, HarvestedJob>()
  for (const job of filtered) {
    dedupedMap.set(job.externalId, job)
  }
  const deduped = [...dedupedMap.values()]

  if (deduped.length === 0) {
    await updateCompanyJobCount(pool, companyId, crawledAtIso)
    return {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      written: 0,
      inputCount,
      filteredOut: inputCount,
    }
  }

  const rows: PersistRow[] = []
  for (const job of deduped) {
    const built = buildPersistRow({ job, companyMeta, crawledAtIso })
    if (built) rows.push(built)
  }

  const result = await pool.query<{ inserted: boolean }>(UPSERT_SQL, [
    companyId,
    crawledAtIso,
    sourceAts,
    sourceAtsSlug,
    JSON.stringify(rows),
  ])

  let inserted = 0
  let updated = 0
  for (const r of result.rows) {
    if (r.inserted) inserted += 1
    else updated += 1
  }
  const written = inserted + updated
  const unchanged = deduped.length - written

  await updateCompanyJobCount(pool, companyId, crawledAtIso)

  return {
    inserted,
    updated,
    unchanged,
    written,
    inputCount,
    filteredOut: inputCount - deduped.length,
  }
}
