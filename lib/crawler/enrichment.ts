import type { Pool } from "pg"
import { normalizePersistedJobRecordWithAI } from "@/lib/jobs/normalization"
import type { PersistedJobForNormalization } from "@/lib/jobs/normalization/types"
import { getPostgresPool } from "@/lib/postgres/server"

const DEFAULT_BATCH_SIZE = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_AI_ENRICHMENT_BATCH_SIZE ?? "40", 10)
)

const DEFAULT_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_AI_ENRICHMENT_CONCURRENCY ?? "4", 10)
)

const DEFAULT_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_AI_ENRICHMENT_MAX_ATTEMPTS ?? "3", 10)
)

type EnrichmentDbJob = PersistedJobForNormalization

type EnrichmentResult = {
  processed: number
  enriched: number
  failed: number
  skipped: number
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toIsoNow() {
  return new Date().toISOString()
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, maxConcurrency: number): Promise<T[]> {
  const results: T[] = []
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const current = idx
      idx += 1
      results.push(await tasks[current]())
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, tasks.length) }).map(() => worker())
  )
  return results
}

async function fetchPendingCandidateIds(pool: Pool, limit: number, maxAttempts: number): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id
     FROM jobs
     WHERE is_active = true
       AND COALESCE(raw_data->>'source', '') = 'crawler'
       AND COALESCE(raw_data->'normalization'->'ai_enrichment'->>'status', '') = 'pending'
       AND COALESCE((raw_data->'normalization'->'ai_enrichment'->>'attempts')::int, 0) < $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [maxAttempts, limit]
  )
  return rows.map((row) => row.id)
}

async function claimJobForProcessing(pool: Pool, id: string, runId: string): Promise<EnrichmentDbJob | null> {
  const nowIso = toIsoNow()
  const { rows } = await pool.query<EnrichmentDbJob>(
    `UPDATE jobs
     SET raw_data = jsonb_set(
       jsonb_set(
         jsonb_set(
           COALESCE(raw_data, '{}'::jsonb),
           '{normalization,ai_enrichment,status}',
           '"processing"'::jsonb,
           true
         ),
         '{normalization,ai_enrichment,processing_started_at}',
         to_jsonb($2::text),
         true
       ),
       '{normalization,ai_enrichment,run_id}',
       to_jsonb($3::text),
       true
     ),
     updated_at = NOW()
     WHERE id = $1::uuid
       AND COALESCE(raw_data->'normalization'->'ai_enrichment'->>'status', '') = 'pending'
     RETURNING id, title, normalized_title, location, apply_url, external_id, description,
               employment_type, seniority_level, is_remote, is_hybrid, salary_min, salary_max,
               salary_currency, sponsors_h1b, sponsorship_score, requires_authorization,
               visa_language_detected, skills, first_detected_at, raw_data`,
    [id, nowIso, runId]
  )

  return rows[0] ?? null
}

async function updateJobAfterEnrichmentSuccess(
  pool: Pool,
  job: EnrichmentDbJob,
  normalization: Awaited<ReturnType<typeof normalizePersistedJobRecordWithAI>>,
  runId: string
): Promise<void> {
  const rawData = toRecord(job.raw_data)
  const normalizationNode = toRecord(rawData.normalization)
  const aiNode = toRecord(normalizationNode.ai_enrichment)
  const attempts = Math.max(1, Number.parseInt(String(aiNode.attempts ?? 0), 10) + 1)
  const nowIso = toIsoNow()

  const nextRawData: Record<string, unknown> = {
    ...rawData,
    source_adapter: normalization.canonical.source.adapter,
    description_captured: Boolean(normalization.nextColumns.description),
    normalization: {
      ...normalizationNode,
      version: normalization.canonical.schema_version,
      normalized_at: normalization.canonical.normalized_at,
      confidence_score: normalization.canonical.validation.confidence_score,
      completeness_score: normalization.canonical.validation.completeness_score,
      requires_review: normalization.canonical.validation.requires_review,
      issues: normalization.canonical.validation.issues,
      ai_enrichment: {
        ...aiNode,
        status: "done",
        attempts,
        run_id: runId,
        enriched_at: nowIso,
        last_error: null,
      },
    },
    normalized: normalization.canonical,
    structured_job: normalization.structuredData,
    view: {
      page: normalization.pageView,
      card: normalization.cardView,
    },
  }

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
         raw_data = $17::jsonb,
         updated_at = NOW()
     WHERE id = $1::uuid`,
    [
      job.id,
      normalization.nextColumns.normalized_title,
      normalization.nextColumns.location,
      normalization.nextColumns.employment_type,
      normalization.nextColumns.seniority_level,
      normalization.nextColumns.is_remote,
      normalization.nextColumns.is_hybrid,
      normalization.nextColumns.requires_authorization,
      normalization.nextColumns.salary_min,
      normalization.nextColumns.salary_max,
      normalization.nextColumns.salary_currency,
      normalization.nextColumns.description,
      normalization.nextColumns.sponsors_h1b,
      normalization.nextColumns.sponsorship_score,
      normalization.nextColumns.visa_language_detected,
      normalization.nextColumns.skills,
      JSON.stringify(nextRawData),
    ]
  )
}

async function updateJobAfterEnrichmentFailure(
  pool: Pool,
  job: EnrichmentDbJob,
  runId: string,
  error: unknown
): Promise<void> {
  const rawData = toRecord(job.raw_data)
  const normalizationNode = toRecord(rawData.normalization)
  const aiNode = toRecord(normalizationNode.ai_enrichment)
  const attempts = Math.max(1, Number.parseInt(String(aiNode.attempts ?? 0), 10) + 1)
  const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)

  const nextRawData: Record<string, unknown> = {
    ...rawData,
    normalization: {
      ...normalizationNode,
      ai_enrichment: {
        ...aiNode,
        status: "pending",
        attempts,
        run_id: runId,
        last_error: message,
        last_failed_at: toIsoNow(),
      },
    },
  }

  await pool.query(
    `UPDATE jobs
     SET raw_data = $2::jsonb,
         updated_at = NOW()
     WHERE id = $1::uuid`,
    [job.id, JSON.stringify(nextRawData)]
  )
}

export async function processPendingCrawlerEnrichmentBatch(options?: {
  pool?: Pool
  batchSize?: number
  concurrency?: number
  maxAttempts?: number
}): Promise<EnrichmentResult> {
  const pool = options?.pool ?? getPostgresPool()
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE)
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_CONCURRENCY)
  const maxAttempts = Math.max(1, options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const runId = `enrich-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const candidateIds = await fetchPendingCandidateIds(pool, batchSize, maxAttempts)
  if (candidateIds.length === 0) {
    return { processed: 0, enriched: 0, failed: 0, skipped: 0 }
  }

  const claimed = await runWithConcurrency(
    candidateIds.map((id) => () => claimJobForProcessing(pool, id, runId)),
    concurrency
  )
  const jobs = claimed.filter((job): job is EnrichmentDbJob => Boolean(job))

  if (jobs.length === 0) {
    return { processed: 0, enriched: 0, failed: 0, skipped: candidateIds.length }
  }

  const outcomes = await runWithConcurrency(
    jobs.map((job) => async () => {
      try {
        const normalization = await normalizePersistedJobRecordWithAI(job)
        await updateJobAfterEnrichmentSuccess(pool, job, normalization, runId)
        return "enriched" as const
      } catch (error) {
        await updateJobAfterEnrichmentFailure(pool, job, runId, error)
        return "failed" as const
      }
    }),
    concurrency
  )

  const enriched = outcomes.filter((outcome) => outcome === "enriched").length
  const failed = outcomes.filter((outcome) => outcome === "failed").length
  const skipped = candidateIds.length - jobs.length

  return {
    processed: jobs.length,
    enriched,
    failed,
    skipped,
  }
}
