import type { Pool, PoolClient } from "pg"
import { isAllowedLocation } from "@/lib/jobs/location-filter"
import { isBlockedApplyUrl, isBlockedCrawlTitle } from "@/lib/jobs/filters"
import { normalizeCrawlerJobForPersistence } from "@/lib/jobs/normalization"
import { hashContent, type HarvestedJob } from "@/lib/harvester/adapters/_base"

/**
 * Anything that exposes pg's parameterised `query()`. Both `Pool` and
 * `PoolClient` satisfy this — letting callers pass a client mid-transaction
 * (e.g. the bench's BEGIN/ROLLBACK throughput probe) without changing
 * persistence behavior.
 */
export type DbExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">

/**
 * Maximum jobs per upsert round-trip. Anything bigger risks blowing the
 * pgbouncer message ceiling and dropping the connection mid-batch. 400 keeps
 * a 4 KB-description payload comfortably under ~2 MB.
 */
const MAX_JOBS_PER_BATCH = (() => {
  const raw = Number.parseInt(process.env.HARVESTER_PERSIST_BATCH_SIZE ?? "", 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : 400
})()

const DEACTIVATION_GRACE_HOURS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_DEACTIVATION_GRACE_HOURS ?? "72", 10)
)
const ALLOW_DEACTIVATE_ON_EMPTY_RESULTS =
  process.env.HARVESTER_ALLOW_DEACTIVATE_ON_EMPTY_RESULTS === "true"
const JOB_DEACTIVATE_BATCH_SIZE = Math.max(
  25,
  Number.parseInt(process.env.HARVESTER_JOB_DEACTIVATE_BATCH_SIZE ?? "250", 10)
)

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

type ActiveJobRow = {
  id: string
  external_id: string | null
  last_seen_at: string | null
}

type ExistingJobStateForPersist = NonNullable<
  Parameters<typeof normalizeCrawlerJobForPersistence>[0]["existing"]
>

type ExistingJobStateRow = ExistingJobStateForPersist & {
  external_id: string | null
}

function chunkValues<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize))
  }
  return out
}

const EMPTY_EXISTING_JOB_STATE: ExistingJobStateForPersist = {
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
}

async function loadExistingJobStates(
  pool: DbExecutor,
  companyId: string,
  externalIds: string[]
): Promise<Map<string, ExistingJobStateForPersist>> {
  if (externalIds.length === 0) return new Map()
  const out = new Map<string, ExistingJobStateForPersist>()
  const result = await pool.query<ExistingJobStateRow>(
    `SELECT external_id,
            description,
            employment_type,
            seniority_level,
            is_remote,
            is_hybrid,
            requires_authorization,
            salary_min,
            salary_max,
            salary_currency,
            sponsors_h1b,
            sponsorship_score,
            visa_language_detected
       FROM jobs
      WHERE company_id = $1
        AND external_id = ANY($2::text[])
        AND is_active = true
        AND external_id IS NOT NULL`,
    [companyId, externalIds]
  )
  for (const row of result.rows) {
    if (!row.external_id) continue
    out.set(row.external_id, {
      description: row.description,
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
    })
  }
  return out
}

function toWellFormedSafe(input: string): string {
  // Node 20+ supports String#toWellFormed. Keep a regex fallback so the same
  // sanitization works in older runtimes and in tests.
  const maybe = (input as string & { toWellFormed?: () => string }).toWellFormed
  if (typeof maybe === "function") return maybe.call(input)
  return input.replace(
    /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    (m) => (m.length === 2 ? m : "\uFFFD")
  )
}

function sanitizeJsonString(input: string): string {
  return toWellFormedSafe(input)
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeJsonString(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item))
  if (!value || typeof value !== "object") return value

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sanitizeJsonValue(item)
  }
  return out
}

function salvageHarvesterDescription(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim()
  if (!normalized) return null
  if (normalized.length < 80) return null
  if (normalized.length > 12_000) return normalized.slice(0, 12_000).trim()

  const letterCount = (normalized.match(/[a-z]/gi) ?? []).length
  const words = normalized.split(/\s+/).length
  if (letterCount < 50 || words < 8) return null

  // Reject common Workday placeholder payloads like requisition IDs.
  if (/^[A-Za-z]\d{6,}$/.test(normalized)) return null

  return normalized
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
  NULLIF(v->>'requires_authorization','')::boolean                               AS requires_authorization,
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
  description            = COALESCE(NULLIF(EXCLUDED.description, ''), jobs.description),
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
  existing?: ExistingJobStateForPersist | null
}): PersistRow | null {
  const { job, companyMeta, crawledAtIso } = args
  const normalizedPostedAt = normalizePostedAtForPersist(job.postedAt, crawledAtIso)
  const usableIncomingDescription = salvageHarvesterDescription(job.description)
  const existing = args.existing ?? EMPTY_EXISTING_JOB_STATE
  const descriptionForNormalization =
    usableIncomingDescription ?? existing.description ?? null
  const usedExistingDescriptionFallback =
    !usableIncomingDescription && Boolean(existing.description)

  const normalization = normalizeCrawlerJobForPersistence({
    rawJob: {
      externalId: job.externalId,
      title: job.title,
      url: job.applyUrl,
      description: descriptionForNormalization ?? undefined,
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
    existing,
  })

  const cols = normalization.nextColumns

  const rawData: RawDataPayload = {
    source: "harvester",
    adapter: normalization.canonical.source.adapter,
    ...normalization.rawSnapshot,
    raw: {
      title: job.title,
      url: job.applyUrl,
      description: descriptionForNormalization,
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
    description: cols.description ?? salvageHarvesterDescription(job.description),
    employment_type: cols.employment_type ?? null,
    seniority_level: cols.seniority_level ?? null,
    is_remote: Boolean(cols.is_remote),
    is_hybrid: Boolean(cols.is_hybrid),
    requires_authorization: cols.requires_authorization ?? null,
    salary_min: cols.salary_min ?? null,
    salary_max: cols.salary_max ?? null,
    salary_currency: cols.salary_currency ?? null,
    skills: cols.skills ?? [],
    sponsors_h1b: cols.sponsors_h1b ?? null,
    sponsorship_score: cols.sponsorship_score ?? null,
    visa_language_detected: cols.visa_language_detected ?? null,
    posted_at: normalizedPostedAt,
    content_hash: usedExistingDescriptionFallback
      ? hashContent([job.contentHash, descriptionForNormalization?.slice(0, 4_000)])
      : job.contentHash,
    raw_data: rawData,
  }
}

async function updateCompanyJobCount(
  pool: DbExecutor,
  companyId: string,
  crawledAtIso: string
): Promise<void> {
  // Self-heal: any company that ends this run with ≥1 active job must be
  // active. Companies that were flipped off long ago by a transient error
  // get to come back. We never flip is_active=false here — only forward.
  await pool.query(
    `UPDATE companies
     SET job_count = (SELECT COUNT(*) FROM jobs WHERE company_id = $1 AND is_active = true),
         last_crawled_at = $2::timestamptz,
         updated_at = $2::timestamptz,
         is_active = CASE
           WHEN (SELECT COUNT(*) FROM jobs WHERE company_id = $1 AND is_active = true) > 0
           THEN true
           ELSE is_active
         END
     WHERE id = $1`,
    [companyId, crawledAtIso]
  )
}

async function deactivateMissingJobs(args: {
  pool: DbExecutor
  companyId: string
  sourceAts: string
  sourceAtsSlug: string
  crawledAtIso: string
  currentExternalIds: ReadonlySet<string>
}): Promise<number> {
  const { pool, companyId, sourceAts, sourceAtsSlug, crawledAtIso, currentExternalIds } = args

  const canDeactivateOnThisRun =
    currentExternalIds.size > 0 || ALLOW_DEACTIVATE_ON_EMPTY_RESULTS
  if (!canDeactivateOnThisRun) return 0

  const activeResult = await pool.query<ActiveJobRow>(
    `SELECT id, external_id, last_seen_at
     FROM jobs
     WHERE company_id = $1
       AND is_active = true
       AND source_ats = $2
       AND source_ats_slug = $3
       AND external_id IS NOT NULL`,
    [companyId, sourceAts, sourceAtsSlug]
  )

  const staleRows = activeResult.rows.filter(
    (row) => row.external_id && !currentExternalIds.has(row.external_id)
  )
  if (staleRows.length === 0) return 0

  const cutoffTs = Date.parse(crawledAtIso) - DEACTIVATION_GRACE_HOURS * 60 * 60 * 1000
  const staleIds = staleRows
    .filter((row) => {
      if (DEACTIVATION_GRACE_HOURS === 0) return true
      const seenTs = row.last_seen_at ? Date.parse(row.last_seen_at) : NaN
      if (!Number.isFinite(seenTs)) return true
      return seenTs <= cutoffTs
    })
    .map((row) => row.id)
  if (staleIds.length === 0) return 0

  for (const staleChunk of chunkValues(staleIds, JOB_DEACTIVATE_BATCH_SIZE)) {
    await pool.query(
      `UPDATE jobs
       SET is_active = false,
           updated_at = $1::timestamptz,
           closed_at = COALESCE(closed_at, $1::timestamptz)
       WHERE id = ANY($2::uuid[])`,
      [crawledAtIso, staleChunk]
    )
  }

  return staleIds.length
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
  const currentExternalIds = new Set(deduped.map((job) => job.externalId))

  if (deduped.length === 0) {
    await deactivateMissingJobs({
      pool,
      companyId,
      sourceAts,
      sourceAtsSlug,
      crawledAtIso,
      currentExternalIds,
    })
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

  const existingByExternalId = await loadExistingJobStates(pool, companyId, [...currentExternalIds])
  const rows: PersistRow[] = []
  for (const job of deduped) {
    const built = buildPersistRow({
      job,
      companyMeta,
      crawledAtIso,
      existing: existingByExternalId.get(job.externalId) ?? null,
    })
    if (built) rows.push(built)
  }

  // Chunk the upsert. The whole payload is sent as a single $5::jsonb param,
  // which means one mega-batch (~4k jobs × 4 KB descriptions ≈ 15 MB JSON)
  // exceeds Supabase's pgbouncer message ceiling and the connection drops
  // mid-flight. Splitting into ~400-row batches keeps each request comfortably
  // under 2 MB while preserving idempotency (each batch shares the same
  // ON CONFLICT semantics).
  let inserted = 0
  let updated = 0
  for (let i = 0; i < rows.length; i += MAX_JOBS_PER_BATCH) {
    const batch = rows.slice(i, i + MAX_JOBS_PER_BATCH)
    const payload = JSON.stringify(sanitizeJsonValue(batch))
    const result = await pool.query<{ inserted: boolean }>(UPSERT_SQL, [
      companyId,
      crawledAtIso,
      sourceAts,
      sourceAtsSlug,
      payload,
    ])
    for (const r of result.rows) {
      if (r.inserted) inserted += 1
      else updated += 1
    }
  }
  const written = inserted + updated
  const unchanged = deduped.length - written

  await deactivateMissingJobs({
    pool,
    companyId,
    sourceAts,
    sourceAtsSlug,
    crawledAtIso,
    currentExternalIds,
  })

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
