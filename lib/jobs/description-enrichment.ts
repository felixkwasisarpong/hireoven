import pLimit from "p-limit"
import type { Pool } from "pg"
import { fetchJobDescription } from "@/lib/jobs/description"
import {
  normalizePersistedJobRecord,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import { publicationStatusForJob, type JobPublicationStatus } from "@/lib/jobs/publication"
import { getPostgresPool } from "@/lib/postgres/server"

const DEFAULT_BATCH_SIZE = Math.max(
  1,
  Number.parseInt(process.env.JOB_DESCRIPTION_ENRICHMENT_BATCH_SIZE ?? "100", 10)
)

const DEFAULT_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.JOB_DESCRIPTION_ENRICHMENT_CONCURRENCY ?? "4", 10)
)

const DEFAULT_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.JOB_DESCRIPTION_ENRICHMENT_MAX_ATTEMPTS ?? "3", 10)
)

const DEFAULT_TIMEOUT_MS = Math.max(
  2_000,
  Number.parseInt(process.env.JOB_DESCRIPTION_ENRICHMENT_TIMEOUT_MS ?? "12000", 10)
)

const DEFAULT_MIN_DESCRIPTION_CHARS = Math.max(
  120,
  Number.parseInt(process.env.JOB_DESCRIPTION_ENRICHMENT_MIN_CHARS ?? "120", 10)
)

// Jobs claimed but left in `processing` longer than this are considered stale
// (the run that claimed them crashed/was killed) and become eligible again.
// Without this, a single interrupted batch strands those jobs in
// pending_enrichment forever, so they never reach the public feed.
const DEFAULT_STALE_PROCESSING_MS = Math.max(
  60_000,
  Number.parseInt(process.env.JOB_DESCRIPTION_ENRICHMENT_STALE_MS ?? "900000", 10)
)

type DescriptionEnrichmentJob = PersistedJobForNormalization & {
  updated_at?: string | null
}

export type DescriptionEnrichmentResult = {
  processed: number
  enriched: number
  published: number
  failed: number
  skipped: number
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toIsoNow(): string {
  return new Date().toISOString()
}

function enrichmentNode(rawData: unknown): Record<string, unknown> {
  return toRecord(toRecord(rawData).description_enrichment)
}

function readAttempts(rawData: unknown): number {
  const raw = enrichmentNode(rawData).attempts
  const parsed = Number.parseInt(String(raw ?? "0"), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  const limit = pLimit(Math.max(1, maxConcurrency))
  return Promise.all(tasks.map((task) => limit(task)))
}

function notProcessingOrStaleSql(intervalParam: string): string {
  return `(
        COALESCE(raw_data->'description_enrichment'->>'status', '') <> 'processing'
        OR COALESCE(
             (raw_data->'description_enrichment'->>'processing_started_at')::timestamptz,
             'epoch'::timestamptz
           ) < NOW() - make_interval(secs => ${intervalParam}::float / 1000)
      )`
}

async function fetchCandidateIds(
  pool: Pool,
  limit: number,
  maxAttempts: number,
  staleMs: number
): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id
       FROM jobs
      WHERE is_active = true
        AND COALESCE(publication_status, 'published') = 'pending_enrichment'
        AND apply_url IS NOT NULL
        AND COALESCE((raw_data->'description_enrichment'->>'attempts')::int, 0) < $1
        AND ${notProcessingOrStaleSql("$3")}
      ORDER BY first_detected_at DESC NULLS LAST, updated_at DESC NULLS LAST
      LIMIT $2`,
    [maxAttempts, limit, staleMs]
  )
  return rows.map((row) => row.id)
}

async function claimJob(
  pool: Pool,
  id: string,
  runId: string,
  maxAttempts: number,
  staleMs: number
): Promise<DescriptionEnrichmentJob | null> {
  const nowIso = toIsoNow()
  const { rows } = await pool.query<DescriptionEnrichmentJob>(
    `UPDATE jobs
        SET raw_data = COALESCE(raw_data, '{}'::jsonb) ||
          jsonb_build_object(
            'description_enrichment',
            jsonb_build_object(
              'mode', 'non_ai',
              'status', 'processing',
              'attempts', COALESCE((raw_data->'description_enrichment'->>'attempts')::int, 0),
              'run_id', $2::text,
              'processing_started_at', $3::text
            )
          ),
            updated_at = NOW()
      WHERE id = $1::uuid
        AND is_active = true
        AND COALESCE(publication_status, 'published') = 'pending_enrichment'
        AND apply_url IS NOT NULL
        AND COALESCE((raw_data->'description_enrichment'->>'attempts')::int, 0) < $4
        AND ${notProcessingOrStaleSql("$5")}
      RETURNING id, title, normalized_title, location, apply_url, external_id, description,
                employment_type, seniority_level, is_remote, is_hybrid, salary_min, salary_max,
                salary_currency, sponsors_h1b, sponsorship_score, requires_authorization,
                visa_language_detected, skills, first_detected_at, raw_data, updated_at`,
    [id, runId, nowIso, maxAttempts, staleMs]
  )
  return rows[0] ?? null
}

export async function markFailure(
  pool: Pool,
  job: DescriptionEnrichmentJob,
  runId: string,
  reason: string,
  maxAttempts: number
): Promise<void> {
  const rawData = toRecord(job.raw_data)
  const attempts = readAttempts(rawData) + 1
  // Once a job exhausts its attempts it can never be re-picked (fetchCandidateIds
  // filters attempts < maxAttempts), so it would sit in pending_enrichment
  // forever — the un-drainable "floor". Retire it to the terminal hidden state so
  // it leaves the pending pool and stops being counted and retried. Only the
  // crawler produces these; harvester jobs arrive with descriptions and never hit
  // this path. A later re-crawl/harvest that finds a description re-publishes it.
  const retired = attempts >= maxAttempts
  await pool.query(
    `UPDATE jobs
        SET raw_data = $2::jsonb,
            publication_status = CASE WHEN $3::boolean THEN 'hidden_low_quality' ELSE publication_status END,
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [
      job.id,
      JSON.stringify({
        ...rawData,
        description_enrichment: {
          ...enrichmentNode(rawData),
          mode: "non_ai",
          status: retired ? "retired" : "failed",
          attempts,
          run_id: runId,
          last_error: reason.slice(0, 500),
          last_failed_at: toIsoNow(),
        },
      }),
      retired,
    ]
  )
}

async function updateSuccess(
  pool: Pool,
  job: DescriptionEnrichmentJob,
  description: string,
  runId: string
): Promise<JobPublicationStatus> {
  const normalized = normalizePersistedJobRecord({ ...job, description })
  const rawData = toRecord(job.raw_data)
  const attempts = readAttempts(rawData) + 1
  const status = publicationStatusForJob({
    description: normalized.nextColumns.description,
    skills: normalized.nextColumns.skills,
  })
  const nowIso = toIsoNow()

  await pool.query(
    `UPDATE jobs
        SET normalized_title = $2,
            location = $3,
            employment_type = $4,
            seniority_level = $5,
            is_remote = $6,
            is_hybrid = $7,
            requires_authorization = $8,
            salary_min = $9,
            salary_max = $10,
            salary_currency = $11,
            description = $12,
            sponsors_h1b = $13,
            sponsorship_score = $14,
            visa_language_detected = $15,
            skills = $16,
            publication_status = $17,
            raw_data = $18::jsonb,
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [
      job.id,
      normalized.nextColumns.normalized_title,
      normalized.nextColumns.location,
      normalized.nextColumns.employment_type,
      normalized.nextColumns.seniority_level,
      normalized.nextColumns.is_remote,
      normalized.nextColumns.is_hybrid,
      normalized.nextColumns.requires_authorization,
      normalized.nextColumns.salary_min,
      normalized.nextColumns.salary_max,
      normalized.nextColumns.salary_currency,
      normalized.nextColumns.description,
      normalized.nextColumns.sponsors_h1b,
      normalized.nextColumns.sponsorship_score,
      normalized.nextColumns.visa_language_detected,
      normalized.nextColumns.skills,
      status,
      JSON.stringify({
        ...rawData,
        description_captured: Boolean(normalized.nextColumns.description),
        normalization: {
          ...toRecord(rawData.normalization),
          version: normalized.canonical.schema_version,
          normalized_at: normalized.canonical.normalized_at,
          confidence_score: normalized.canonical.validation.confidence_score,
          completeness_score: normalized.canonical.validation.completeness_score,
          requires_review: normalized.canonical.validation.requires_review,
          issues: normalized.canonical.validation.issues,
        },
        normalized: normalized.canonical,
        structured_job: normalized.structuredData,
        view: {
          page: normalized.pageView,
          card: normalized.cardView,
        },
        description_enrichment: {
          ...enrichmentNode(rawData),
          mode: "non_ai",
          status: "done",
          attempts,
          run_id: runId,
          enriched_at: nowIso,
          last_error: null,
        },
      }),
    ]
  )

  return status
}

export async function processPendingDescriptionEnrichmentBatch(options?: {
  pool?: Pool
  batchSize?: number
  concurrency?: number
  maxAttempts?: number
  timeoutMs?: number
  minDescriptionChars?: number
  staleProcessingMs?: number
}): Promise<DescriptionEnrichmentResult> {
  const pool = options?.pool ?? getPostgresPool()
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE)
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_CONCURRENCY)
  const maxAttempts = Math.max(1, options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const timeoutMs = Math.max(2_000, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const minDescriptionChars = Math.max(
    120,
    options?.minDescriptionChars ?? DEFAULT_MIN_DESCRIPTION_CHARS
  )
  const staleProcessingMs = Math.max(
    60_000,
    options?.staleProcessingMs ?? DEFAULT_STALE_PROCESSING_MS
  )
  const runId = `desc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const ids = await fetchCandidateIds(pool, batchSize, maxAttempts, staleProcessingMs)
  if (ids.length === 0) {
    return { processed: 0, enriched: 0, published: 0, failed: 0, skipped: 0 }
  }

  const claimed = await runWithConcurrency(
    ids.map((id) => () => claimJob(pool, id, runId, maxAttempts, staleProcessingMs)),
    concurrency
  )
  const jobs = claimed.filter((job): job is DescriptionEnrichmentJob => Boolean(job))
  if (jobs.length === 0) {
    return { processed: 0, enriched: 0, published: 0, failed: 0, skipped: ids.length }
  }

  const outcomes = await runWithConcurrency(
    jobs.map((job) => async () => {
      const description = await fetchJobDescription(job.apply_url, timeoutMs)
      if (!description || description.trim().length < minDescriptionChars) {
        await markFailure(
          pool,
          job,
          runId,
          description ? "description_too_short" : "description_fetch_failed",
          maxAttempts
        )
        return "failed" as const
      }

      const status = await updateSuccess(pool, job, description, runId)
      return status === "published" ? "published" as const : "enriched" as const
    }),
    concurrency
  )

  return {
    processed: jobs.length,
    enriched: outcomes.filter((outcome) => outcome === "enriched" || outcome === "published").length,
    published: outcomes.filter((outcome) => outcome === "published").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
    skipped: ids.length - jobs.length,
  }
}
