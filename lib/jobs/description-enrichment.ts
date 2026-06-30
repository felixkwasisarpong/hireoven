import pLimit from "p-limit"
import type { Pool } from "pg"
import { counter } from "@/lib/observability/metrics"
import { fetchJobDescription } from "@/lib/jobs/description"
import {
  createBrowserDescriptionFetcher,
  type BrowserDescriptionFetcher,
} from "@/lib/jobs/description-browser"
import {
  normalizePersistedJobRecord,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import {
  publicationStatusForNormalization,
  type JobPublicationStatus,
} from "@/lib/jobs/publication"
import { safeJsonStringify } from "@/lib/jobs/json-sanitize"
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

// --- Playwright fallback (off by default) -----------------------------------
// When the plain HTTP fetch returns nothing usable, optionally re-try the URL
// in a real browser. Heavy, so it's opt-in and tightly bounded: a small
// concurrency, a per-run ceiling, and a short per-page timeout keep it from
// pegging the shared harvester box (4 vCPU / 8 GB). See description-browser.ts.
const BROWSER_FALLBACK_ENABLED =
  process.env.JOB_DESCRIPTION_ENRICHMENT_BROWSER === "true"
const BROWSER_FALLBACK_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.JOB_DESCRIPTION_ENRICHMENT_BROWSER_CONCURRENCY ?? "3", 10)
)
const BROWSER_FALLBACK_MAX_PER_RUN = Math.max(
  0,
  Number.parseInt(process.env.JOB_DESCRIPTION_ENRICHMENT_BROWSER_MAX ?? "150", 10)
)
const BROWSER_FALLBACK_TIMEOUT_MS = Math.max(
  3_000,
  Number.parseInt(process.env.JOB_DESCRIPTION_ENRICHMENT_BROWSER_TIMEOUT_MS ?? "10000", 10)
)

/**
 * Resolve `p`, or `fallback` if it hasn't settled within `ms`. Unlike a plain
 * Promise.race this never rejects and clears its timer, so a hung promise can't
 * keep the event loop alive or leak. Used to cap browser renders whose
 * underlying Playwright calls have no enforceable timeout.
 */
function withHardTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, ms)
    const finish = (value: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    p.then(finish, () => finish(fallback))
  })
}

const DESCRIPTION_ENRICHABLE_SOURCE_ATS = [
  "ashby",
  "bamboohr",
  "greenhouse",
  "icims",
  "jazzhr",
  "jobvite",
  "lever",
  "rippling",
  "smartrecruiters",
  "workday",
] as const

const DESCRIPTION_ENRICHABLE_APPLY_URL_PATTERN =
  "(ashbyhq\\.com|bamboohr\\.com|greenhouse\\.io|icims\\.com|applytojob\\.com|jobvite\\.com|jobs\\.lever\\.co|ats\\.rippling\\.com|smartrecruiters\\.com|myworkdayjobs\\.com)"

type DescriptionEnrichmentJob = PersistedJobForNormalization & {
  updated_at?: string | null
}

type Outcome = "published" | "enriched" | "failed"

export type DescriptionEnrichmentResult = {
  processed: number
  enriched: number
  published: number
  failed: number
  skipped: number
  /** Jobs that fell through HTTP and were retried in a browser this run. */
  browserAttempted?: number
  /** Of those, how many the browser fallback resolved. */
  browserEnriched?: number
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

// Fields from raw_data that are actually read at runtime (dedup lookups,
// extension resolve, signal tenant filters). Everything else from the
// original source blob is dropped after enrichment to keep TOAST small.
const SLIM_RAW_DATA_KEYS = [
  "apexSource", "apexSourceId", "apexSources",
  "signalTenantId", "captureSource", "hiring_entity",
  "sourceUrl", "canonicalSourceUrl", "applyUrl", "canonicalApplyUrl",
  "metadata",
] as const

function slimRawData(rawData: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of SLIM_RAW_DATA_KEYS) {
    if (rawData[key] !== undefined) out[key] = rawData[key]
  }
  return out
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

function enrichablePublicationStatusSql(
  minDescriptionCharsParam: string,
  sourceAtsParam: string,
  applyUrlPatternParam: string
): string {
  return `(
        COALESCE(publication_status, 'published') = 'pending_enrichment'
        OR (
          COALESCE(publication_status, 'published') = 'hidden_low_quality'
          AND COALESCE(length(description), 0) < ${minDescriptionCharsParam}
          AND (
            source_ats = ANY(${sourceAtsParam}::text[])
            OR apply_url ~* ${applyUrlPatternParam}
          )
        )
      )`
}

async function fetchCandidateIds(
  pool: Pool,
  limit: number,
  maxAttempts: number,
  staleMs: number,
  minDescriptionChars: number
): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id
       FROM jobs
      WHERE is_active = true
        AND ${enrichablePublicationStatusSql("$4", "$5", "$6")}
        AND apply_url IS NOT NULL
        AND COALESCE((raw_data->'description_enrichment'->>'attempts')::int, 0) < $1
        AND ${notProcessingOrStaleSql("$3")}
      ORDER BY first_detected_at DESC NULLS LAST, updated_at DESC NULLS LAST
      LIMIT $2`,
    [
      maxAttempts,
      limit,
      staleMs,
      minDescriptionChars,
      DESCRIPTION_ENRICHABLE_SOURCE_ATS,
      DESCRIPTION_ENRICHABLE_APPLY_URL_PATTERN,
    ]
  )
  return rows.map((row) => row.id)
}

async function claimJob(
  pool: Pool,
  id: string,
  runId: string,
  maxAttempts: number,
  staleMs: number,
  minDescriptionChars: number
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
        AND ${enrichablePublicationStatusSql("$6", "$7", "$8")}
        AND apply_url IS NOT NULL
        AND COALESCE((raw_data->'description_enrichment'->>'attempts')::int, 0) < $4
        AND ${notProcessingOrStaleSql("$5")}
      RETURNING id, title, normalized_title, location, apply_url, external_id, description,
                employment_type, seniority_level, is_remote, is_hybrid, salary_min, salary_max,
                salary_currency, sponsors_h1b, sponsorship_score, requires_authorization,
                visa_language_detected, skills, first_detected_at, raw_data, updated_at`,
    [
      id,
      runId,
      nowIso,
      maxAttempts,
      staleMs,
      minDescriptionChars,
      DESCRIPTION_ENRICHABLE_SOURCE_ATS,
      DESCRIPTION_ENRICHABLE_APPLY_URL_PATTERN,
    ]
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
  // it leaves the retry pool and stops being counted. A later re-crawl/harvest
  // that finds a description re-publishes it.
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
        ...slimRawData(rawData),
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
  const status = publicationStatusForNormalization(normalized)
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
      safeJsonStringify({
        ...slimRawData(rawData),
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

  // Conversion signal: which source's pending jobs got enriched, and to what
  // status ('published' = promoted into the feed). Powers the discovery-stats
  // Adzuna enrich conversion rate.
  const src = typeof rawData.source === "string" ? rawData.source : "unknown"
  counter("description_enrichment.result", { source: src, status })

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

  const ids = await fetchCandidateIds(
    pool,
    batchSize,
    maxAttempts,
    staleProcessingMs,
    minDescriptionChars
  )
  if (ids.length === 0) {
    return { processed: 0, enriched: 0, published: 0, failed: 0, skipped: 0 }
  }

  const claimed = await runWithConcurrency(
    ids.map((id) => () =>
      claimJob(pool, id, runId, maxAttempts, staleProcessingMs, minDescriptionChars)
    ),
    concurrency
  )
  const jobs = claimed.filter((job): job is DescriptionEnrichmentJob => Boolean(job))
  if (jobs.length === 0) {
    return { processed: 0, enriched: 0, published: 0, failed: 0, skipped: ids.length }
  }

  const finalizeSuccess = async (
    job: DescriptionEnrichmentJob,
    description: string
  ): Promise<Outcome> => {
    const status = await updateSuccess(pool, job, description, runId)
    return status === "published" ? "published" : "enriched"
  }

  // Phase 1 — plain HTTP fetch. Successes are persisted immediately; the cheap
  // failures are collected for the (optional) browser retry rather than being
  // marked failed right away.
  const settled: Outcome[] = []
  const needsBrowser: DescriptionEnrichmentJob[] = []
  const httpResults = await runWithConcurrency(
    jobs.map((job) => async () => {
      const description = await fetchJobDescription(job.apply_url, timeoutMs)
      if (description && description.trim().length >= minDescriptionChars) {
        return { done: true as const, outcome: await finalizeSuccess(job, description) }
      }
      return { done: false as const, job }
    }),
    concurrency
  )
  for (const result of httpResults) {
    if (result.done) settled.push(result.outcome)
    else needsBrowser.push(result.job)
  }

  // Phase 2 — browser fallback (opt-in, bounded). Only the jobs HTTP couldn't
  // resolve reach here, and only up to BROWSER_FALLBACK_MAX_PER_RUN are rendered
  // so the box is never flooded. Anything not handled is marked failed so it
  // retries on a later cycle (and retires after maxAttempts).
  let browserAttempted = 0
  let browserEnriched = 0
  const failWithReason = async (job: DescriptionEnrichmentJob, reason: string) => {
    await markFailure(pool, job, runId, reason, maxAttempts)
    settled.push("failed")
  }

  let fetcher: BrowserDescriptionFetcher | null = null
  if (BROWSER_FALLBACK_ENABLED && BROWSER_FALLBACK_MAX_PER_RUN > 0 && needsBrowser.length > 0) {
    try {
      fetcher = await createBrowserDescriptionFetcher()
    } catch {
      fetcher = null
    }
  }

  if (fetcher) {
    const toRender = needsBrowser.slice(0, BROWSER_FALLBACK_MAX_PER_RUN)
    const overflow = needsBrowser.slice(BROWSER_FALLBACK_MAX_PER_RUN)
    browserAttempted = toRender.length
    try {
      const limit = pLimit(BROWSER_FALLBACK_CONCURRENCY)
      const rendered = await Promise.all(
        toRender.map((job) =>
          limit(async () => {
            let description: string | null = null
            try {
              // Hard wall-clock cap around the whole fetch. fetcher.fetch bounds
              // page.goto, but context.newPage()/page.content()/page.close() have
              // no Playwright timeout — if chromium wedges, those hang forever and
              // a single stuck render makes this Promise.all never resolve, hanging
              // the endpoint (and freezing the flock-guarded cron queue). The race
              // guarantees every job settles within the timeout + slack.
              description = await withHardTimeout(
                fetcher!.fetch(job.apply_url, BROWSER_FALLBACK_TIMEOUT_MS),
                BROWSER_FALLBACK_TIMEOUT_MS + 5_000,
                null
              )
            } catch {
              description = null
            }
            if (description && description.trim().length >= minDescriptionChars) {
              return finalizeSuccess(job, description)
            }
            await markFailure(
              pool,
              job,
              runId,
              description ? "description_too_short" : "browser_fetch_failed",
              maxAttempts
            )
            return "failed" as Outcome
          })
        )
      )
      settled.push(...rendered)
      browserEnriched = rendered.filter((o) => o !== "failed").length
      // Jobs past the per-run ceiling: fail now, retry next cycle.
      for (const job of overflow) await failWithReason(job, "description_fetch_failed")
    } finally {
      // close() can also hang on a wedged browser — bound it so the run returns.
      await withHardTimeout(fetcher.close(), 10_000, undefined)
    }
  } else {
    // Browser disabled or unavailable — original behavior for HTTP failures.
    for (const job of needsBrowser) await failWithReason(job, "description_fetch_failed")
  }

  return {
    processed: jobs.length,
    enriched: settled.filter((outcome) => outcome === "enriched" || outcome === "published").length,
    published: settled.filter((outcome) => outcome === "published").length,
    failed: settled.filter((outcome) => outcome === "failed").length,
    skipped: ids.length - jobs.length,
    browserAttempted,
    browserEnriched,
  }
}
