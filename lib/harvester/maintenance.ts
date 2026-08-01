import type { Pool } from "pg"

/**
 * Nightly company maintenance: tier auto-assignment + status lifecycle.
 *
 * Both phases are single-statement UPDATEs guarded by `IS DISTINCT FROM`, so a
 * no-op pass touches zero rows. dryRun wraps each statement in BEGIN/ROLLBACK
 * — the planner runs identically, the RETURNING count is real, nothing is
 * persisted.
 */

export const TIER_ASSIGNMENT_SQL = `
WITH new_tiers AS (
  SELECT
    c.id,
    CASE
      WHEN EXISTS (SELECT 1 FROM watchlist w WHERE w.company_id = c.id)
        THEN 'tier_1'
      -- Top H1B sponsors get tier_1 unconditionally. Custom-ATS parsers
      -- often misread their career pages, so recent-job signal alone
      -- demotes them to tier_dead. Sponsorship volume is a stronger
      -- "this company is hiring" signal than our extraction success rate.
      WHEN COALESCE(c.h1b_sponsor_count_1yr, 0) >= 50
        THEN 'tier_1'
      WHEN COUNT(j.id) FILTER (
        WHERE j.is_active = true AND j.first_detected_at >= now() - interval '24 hours'
      ) >= 1 THEN 'tier_1'
      WHEN COUNT(j.id) FILTER (
        WHERE j.is_active = true AND j.first_detected_at >= now() - interval '7 days'
      ) >= 5 THEN 'tier_1'
      WHEN COALESCE(c.h1b_sponsor_count_1yr, 0) >= 10
        THEN 'tier_2'
      WHEN COUNT(j.id) FILTER (
        WHERE j.is_active = true AND j.first_detected_at >= now() - interval '30 days'
      ) >= 1 THEN 'tier_2'
      WHEN MAX(j.first_detected_at) >= now() - interval '90 days' THEN 'tier_3'
      WHEN MAX(j.first_detected_at) IS NULL AND c.last_crawled_at IS NULL
        THEN 'tier_2'  -- brand-new discovery, no signal yet
      ELSE 'tier_dead'
    END AS new_tier
  FROM companies c
  LEFT JOIN jobs j ON j.company_id = c.id
  WHERE c.status IN ('active', 'unknown')
  GROUP BY c.id
)
UPDATE companies
SET freshness_tier = new_tiers.new_tier,
    updated_at     = now()
FROM new_tiers
WHERE companies.id = new_tiers.id
  AND companies.freshness_tier IS DISTINCT FROM new_tiers.new_tier
RETURNING new_tiers.new_tier AS tier
`

export const RESURRECTION_SQL = `
UPDATE companies
SET status     = 'active',
    updated_at = now()
WHERE status = 'dead'
  AND updated_at < now() - interval '30 days'
RETURNING id
`

/**
 * Cross-ATS dedup. Partitions active jobs by
 *   (company_id, lower(normalized_title || title), lower(location ?? ''))
 * and marks all non-earliest rows with `duplicate_of_id = canonical row's id`.
 *
 * Title key uses `coalesce(normalized_title, title)` because some rows haven't
 * been normalized yet. Location is lower-cased and trimmed; NULL location
 * coalesces to empty string so partitioning is stable across nullability.
 *
 * Idempotent: only touches rows whose duplicate_of_id is wrong.
 *
 * To reduce lock contention with live crawls/harvester updates, this pass only
 * processes rows older than `MAINTENANCE_DEDUP_MIN_ROW_AGE_MINUTES` (default:
 * 180 minutes). Freshly-updated rows are picked up on the next cycle.
 */
export const DEDUP_SQL = `
WITH ranked AS (
  SELECT
    j.id,
    row_number() OVER (
      PARTITION BY
        j.company_id,
        lower(trim(regexp_replace(COALESCE(j.normalized_title, j.title), '\\s+', ' ', 'g'))),
        lower(trim(COALESCE(j.location, '')))
      ORDER BY
        j.first_detected_at ASC NULLS LAST,
        j.id
    ) AS rn,
    first_value(j.id) OVER (
      PARTITION BY
        j.company_id,
        lower(trim(regexp_replace(COALESCE(j.normalized_title, j.title), '\\s+', ' ', 'g'))),
        lower(trim(COALESCE(j.location, '')))
      ORDER BY
        j.first_detected_at ASC NULLS LAST,
        j.id
    ) AS canonical_id
  FROM jobs j
  WHERE j.is_active = true
    AND j.closed_at IS NULL
    AND j.title IS NOT NULL
    AND COALESCE(j.updated_at, j.first_detected_at, to_timestamp(0)) < now() - $1::interval
)
UPDATE jobs
SET duplicate_of_id = ranked.canonical_id,
    updated_at = now()
FROM ranked
WHERE jobs.id = ranked.id
  AND ranked.rn > 1
  AND jobs.duplicate_of_id IS DISTINCT FROM ranked.canonical_id
RETURNING jobs.id
`

/**
 * Companies-level dedup. Two `companies` rows with the same canonical ATS board
 * map to the same harvest source and would harvest identical jobs. Pick the
 * richest canonical (active > inactive, canonical identifier > legacy alias,
 * more jobs > fewer, older > newer) and point the rest at it via
 * `duplicate_of_company_id`. The worker's claim filter then skips duplicates.
 *
 * Workday historically entered the DB in both `{tenant}:{wd}:{site}` and
 * `{tenant}/{site}` forms. Canonicalize from the URL when possible so legacy
 * rows like `takeda/External` collapse with `takeda:wd3:external`.
 */
export const COMPANY_DEDUP_SQL = `
WITH keyed AS (
  SELECT
    c.*,
    CASE
      WHEN c.ats_type = 'workday' THEN
        COALESCE(
          CASE
            WHEN COALESCE(NULLIF(c.direct_ats_url, ''), NULLIF(c.careers_url, ''), '') ~* '^https?://[a-z0-9_-]+\\.wd[0-9]{1,3}\\.myworkdayjobs\\.com/(?:[a-z]{2}(?:-[a-z]{2,3})?/)?[A-Za-z0-9_-]+'
            THEN lower(regexp_replace(
              COALESCE(NULLIF(c.direct_ats_url, ''), NULLIF(c.careers_url, ''), ''),
              '^https?://([a-z0-9_-]+)\\.(wd[0-9]{1,3})\\.myworkdayjobs\\.com/(?:[a-z]{2}(?:-[a-z]{2,3})?/)?([A-Za-z0-9_-]+).*$',
              '\\1:\\2:\\3',
              'i'
            ))
          END,
          CASE
            WHEN trim(c.ats_identifier) ~* '^[a-z0-9_-]+:wd[0-9]{1,3}:[A-Za-z0-9_-]+$'
            THEN lower(trim(c.ats_identifier))
          END,
          lower(trim(c.ats_identifier))
        )
      ELSE lower(trim(c.ats_identifier))
    END AS ats_dedupe_key
  FROM companies c
  WHERE c.ats_type IS NOT NULL
    AND c.ats_identifier IS NOT NULL
    AND length(trim(c.ats_identifier)) > 0
),
ranked AS (
  SELECT
    c.id,
    row_number() OVER (
      PARTITION BY c.ats_type, c.ats_dedupe_key
      ORDER BY
        CASE WHEN c.status = 'active' THEN 0 ELSE 1 END,
        CASE WHEN lower(trim(c.ats_identifier)) = c.ats_dedupe_key THEN 0 ELSE 1 END,
        COALESCE(c.job_count, 0) DESC,
        c.created_at ASC NULLS LAST,
        c.id
    ) AS rn,
    first_value(c.id) OVER (
      PARTITION BY c.ats_type, c.ats_dedupe_key
      ORDER BY
        CASE WHEN c.status = 'active' THEN 0 ELSE 1 END,
        CASE WHEN lower(trim(c.ats_identifier)) = c.ats_dedupe_key THEN 0 ELSE 1 END,
        COALESCE(c.job_count, 0) DESC,
        c.created_at ASC NULLS LAST,
        c.id
    ) AS canonical_id
  FROM keyed c
  WHERE c.ats_dedupe_key IS NOT NULL
    AND length(c.ats_dedupe_key) > 0
)
UPDATE companies
SET duplicate_of_company_id = ranked.canonical_id,
    updated_at = now()
FROM ranked
WHERE companies.id = ranked.id
  AND ranked.rn > 1
  AND companies.duplicate_of_company_id IS DISTINCT FROM ranked.canonical_id
RETURNING companies.id
`

/**
 * Trigram-fuzzy dedup. Runs AFTER exact dedup; only considers jobs that
 * survived as canonicals (`duplicate_of_id IS NULL`). For each company, finds
 * pairs of active jobs whose titles are similar above the threshold and
 * whose locations match (or one is null). The later first_detected_at row
 * becomes the duplicate, pointing at the earlier.
 *
 * Threshold is passed via SET LOCAL so the `%` operator (which uses the GIN
 * trgm index) honors the value within this transaction only — never leaks to
 * other connections. Default 0.7 captures "Senior" vs "Sr." while rejecting
 * "Backend" vs "Frontend".
 */
export const FUZZY_DEDUP_SQL = `
WITH candidate_pairs AS (
  SELECT
    a.id AS a_id,
    b.id AS b_id,
    a.first_detected_at AS a_first_seen,
    b.first_detected_at AS b_first_seen
  FROM jobs a
  JOIN jobs b
    ON a.id < b.id
    AND a.company_id = b.company_id
    AND a.is_active = true AND a.closed_at IS NULL AND a.duplicate_of_id IS NULL
    AND b.is_active = true AND b.closed_at IS NULL AND b.duplicate_of_id IS NULL
    AND a.title % b.title
    AND (
      lower(trim(COALESCE(a.location, ''))) = lower(trim(COALESCE(b.location, '')))
      OR a.location IS NULL
      OR b.location IS NULL
    )
),
ranked AS (
  SELECT
    CASE WHEN a_first_seen <= b_first_seen THEN a_id ELSE b_id END AS canonical_id,
    CASE WHEN a_first_seen <= b_first_seen THEN b_id ELSE a_id END AS duplicate_id
  FROM candidate_pairs
)
UPDATE jobs
SET duplicate_of_id = ranked.canonical_id,
    updated_at = now()
FROM ranked
WHERE jobs.id = ranked.duplicate_id
  AND jobs.duplicate_of_id IS DISTINCT FROM ranked.canonical_id
RETURNING jobs.id
`

export const STATUS_LIFECYCLE_SQL = `
WITH recent AS (
  SELECT
    company_id,
    COUNT(*)                                                                AS total,
    COUNT(*) FILTER (
      WHERE status IN ('failed', 'fetch_error', 'bad_url', 'blocked')
    )                                                                       AS failures,
    MAX(CASE WHEN status = 'success' THEN crawled_at END)                   AS last_success
  FROM crawl_logs
  WHERE crawled_at >= now() - interval '14 days'
  GROUP BY company_id
)
UPDATE companies
SET status     = 'dead',
    updated_at = now()
FROM recent
WHERE companies.id = recent.company_id
  AND companies.status = 'active'
  AND recent.failures >= 7
  AND recent.failures = recent.total
  AND (recent.last_success IS NULL OR recent.last_success < now() - interval '14 days')
  -- Don't auto-dead top H1B sponsors even when our parser keeps failing
  -- against their custom careers pages — the company is clearly hiring,
  -- the problem is our extraction. Keep them claimable so any parser
  -- improvement lands a recovery automatically.
  AND COALESCE(companies.h1b_sponsor_count_1yr, 0) < 10
RETURNING companies.id
`

export type TierAssignmentSummary = {
  changed: number
  byTier: Record<string, number>
  dryRun: boolean
}

export type StatusLifecycleSummary = {
  markedDead: number
  dryRun: boolean
}

export type ResurrectionSummary = {
  resurrected: number
  dryRun: boolean
}

export type DedupSummary = {
  markedDuplicate: number
  dryRun: boolean
}

export type FuzzyDedupSummary = {
  markedDuplicate: number
  threshold: number
  dryRun: boolean
}

export type CompanyDedupSummary = {
  markedDuplicate: number
  dryRun: boolean
}

/**
 * Postgres deadlock error code (40P01). Maintenance phases UPDATE wide swaths
 * of `jobs`/`companies` while the legacy crawler may concurrently UPDATE
 * individual rows — under contention, Postgres rolls back one of the two
 * transactions. Maintenance phases are idempotent on retry, so we just
 * back off and try again rather than crash the cron.
 */
const DEADLOCK_CODE = "40P01"
const SERIALIZATION_CODE = "40001"
const LOCK_NOT_AVAILABLE_CODE = "55P03"
const MAX_RETRIES = Math.max(
  3,
  Number.parseInt(process.env.MAINTENANCE_RETRY_ATTEMPTS ?? "8", 10) || 8
)
const RETRY_BASE_MS = Math.max(
  100,
  Number.parseInt(process.env.MAINTENANCE_RETRY_BASE_MS ?? "300", 10) || 300
)
const LOCK_TIMEOUT_MS = Math.max(
  500,
  Number.parseInt(process.env.MAINTENANCE_LOCK_TIMEOUT_MS ?? "3000", 10) || 3000
)
const DEDUP_MIN_ROW_AGE_MINUTES = Math.max(
  0,
  Number.parseInt(process.env.MAINTENANCE_DEDUP_MIN_ROW_AGE_MINUTES ?? "180", 10) || 180
)

function isRetryableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return (
    code === DEADLOCK_CODE ||
    code === SERIALIZATION_CODE ||
    code === LOCK_NOT_AVAILABLE_CODE
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runWithOptionalRollback<T>(
  pool: Pool,
  dryRun: boolean,
  run: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  let attempt = 0
  let lastError: unknown = null
  while (attempt < MAX_RETRIES) {
    attempt += 1
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      // Keep maintenance from waiting too long on hot rows while crawlers are
      // updating them; we retry with backoff instead.
      await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`)
      const result = await run(client)
      if (dryRun) {
        await client.query("ROLLBACK")
      } else {
        await client.query("COMMIT")
      }
      return result
    } catch (error) {
      try {
        await client.query("ROLLBACK")
      } catch {}
      lastError = error
      if (!isRetryableError(error) || attempt >= MAX_RETRIES) {
        throw error
      }
      const code = (error as { code?: string } | null)?.code ?? "unknown"
      // Jittered exponential backoff gives concurrent crawls time to release
      // row locks before retrying the same idempotent statement.
      const backoffMs = RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 300)
      console.warn(
        `[maintenance] retryable error code=${code} attempt=${attempt}/${MAX_RETRIES} backoffMs=${backoffMs}`
      )
      await sleep(backoffMs)
    } finally {
      client.release()
    }
  }
  throw lastError ?? new Error("runWithOptionalRollback exhausted retries")
}

export async function assignTiers(
  pool: Pool,
  options: { dryRun: boolean }
): Promise<TierAssignmentSummary> {
  return runWithOptionalRollback(pool, options.dryRun, async (client) => {
    const { rows } = await client.query<{ tier: string }>(TIER_ASSIGNMENT_SQL)
    const byTier: Record<string, number> = {}
    for (const row of rows) {
      byTier[row.tier] = (byTier[row.tier] ?? 0) + 1
    }
    return { changed: rows.length, byTier, dryRun: options.dryRun }
  })
}

export async function updateStatus(
  pool: Pool,
  options: { dryRun: boolean }
): Promise<StatusLifecycleSummary> {
  return runWithOptionalRollback(pool, options.dryRun, async (client) => {
    const { rows } = await client.query<{ id: string }>(STATUS_LIFECYCLE_SQL)
    return { markedDead: rows.length, dryRun: options.dryRun }
  })
}

/**
 * Promote `dead` companies back to `active` once they've been dead for 30+
 * days. Gives them another shot at the worker. If they're still broken, the
 * status-lifecycle phase will re-mark them dead within 7+ failures (~14 days).
 * If they recovered, jobs will land and they stay active. The 30-day gate (on
 * `updated_at`) prevents permanently-dead companies from cycling more often
 * than monthly.
 */
export async function resurrectDeadCompanies(
  pool: Pool,
  options: { dryRun: boolean }
): Promise<ResurrectionSummary> {
  return runWithOptionalRollback(pool, options.dryRun, async (client) => {
    const { rows } = await client.query<{ id: string }>(RESURRECTION_SQL)
    return { resurrected: rows.length, dryRun: options.dryRun }
  })
}

/**
 * Mark jobs as cross-ATS duplicates. Same role on multiple ATSes (Greenhouse
 * + Lever, etc.) collapses to a single canonical record. The harvester's
 * UPSERT path doesn't touch `duplicate_of_id`, so this survives re-harvests.
 */
export async function dedupJobs(
  pool: Pool,
  options: { dryRun: boolean }
): Promise<DedupSummary> {
  const ageInterval = `${DEDUP_MIN_ROW_AGE_MINUTES} minutes`
  return runWithOptionalRollback(pool, options.dryRun, async (client) => {
    const { rows } = await client.query<{ id: string }>(DEDUP_SQL, [ageInterval])
    return { markedDuplicate: rows.length, dryRun: options.dryRun }
  })
}

/**
 * Mark companies as duplicates by `(ats_type, ats_identifier)`. The
 * harvester's claim filter excludes rows with `duplicate_of_company_id`, so
 * duplicates stop occupying tick slots. Existing jobs under the duplicate
 * remain attached to it — relinking is a separate, larger concern.
 */
export async function dedupCompanies(
  pool: Pool,
  options: { dryRun: boolean }
): Promise<CompanyDedupSummary> {
  return runWithOptionalRollback(pool, options.dryRun, async (client) => {
    const { rows } = await client.query<{ id: string }>(COMPANY_DEDUP_SQL)
    return { markedDuplicate: rows.length, dryRun: options.dryRun }
  })
}

/**
 * Fuzzy dedup pass. Catches "Senior" vs "Sr.", "Software Engineer" vs
 * "Software Engineer II", etc. — pairs that exact-match dedup misses. Should
 * run AFTER `dedupJobs` so the candidate set is already minimized.
 *
 * Threshold ∈ (0, 1]. Default 0.7. Lower values catch more variants but risk
 * collapsing genuinely-different roles ("Backend" vs "Frontend" sit around
 * 0.5 similarity).
 */
export async function fuzzyDedupJobs(
  pool: Pool,
  options: { dryRun: boolean; threshold?: number }
): Promise<FuzzyDedupSummary> {
  const threshold = Math.max(0.01, Math.min(1, options.threshold ?? 0.7))
  return runWithOptionalRollback(pool, options.dryRun, async (client) => {
    // SET LOCAL scopes to this transaction only; the `%` operator on the GIN
    // index reads this GUC.
    await client.query(`SET LOCAL pg_trgm.similarity_threshold = ${threshold.toFixed(3)}`)
    const { rows } = await client.query<{ id: string }>(FUZZY_DEDUP_SQL)
    return { markedDuplicate: rows.length, threshold, dryRun: options.dryRun }
  })
}
