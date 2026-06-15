import type { Pool } from "pg"
import { getPostgresPool } from "@/lib/postgres/server"

/**
 * Job retention / self-cleaning.
 *
 * Inactive jobs (is_active=false — deactivated by ghost-scan, expiry, the
 * harvester no longer seeing them, or cleanups) are never deleted otherwise, so
 * the jobs table grows unbounded (it reached 2M+ dead rows / 42 GB). This purges
 * inactive jobs not seen in `olderThanDays` days, in safe batches.
 *
 * Preserves any job a USER interacted with — the NO-ACTION FKs below would block
 * the delete anyway, so we exclude them explicitly. Derived/cache tables
 * (ghost_job_scores, job_match_scores, job_normalizations, job_timing_scores,
 * alert_notifications, resume_analyses) are ON DELETE CASCADE and clean up
 * automatically.
 */

const DEFAULT_DAYS = Math.max(
  7,
  Number.parseInt(process.env.JOB_RETENTION_DAYS ?? "30", 10)
)
const DEFAULT_BATCH = Math.max(
  100,
  Number.parseInt(process.env.JOB_RETENTION_BATCH ?? "5000", 10)
)
const DEFAULT_MAX_BATCHES = Math.max(
  1,
  Number.parseInt(process.env.JOB_RETENTION_MAX_BATCHES ?? "50", 10)
)

// One bounded batch. Excludes jobs referenced by any user-data table (the
// NO-ACTION FKs) so the delete never errors and never loses user history.
const DELETE_BATCH_SQL = `
WITH candidates AS (
  SELECT j.id
  FROM jobs j
  WHERE j.is_active = false
    -- last_seen_at (not COALESCE) so the partial index
    -- idx_jobs_inactive_last_seen WHERE is_active=false is used. Jobs with a NULL
    -- last_seen_at are skipped (rare; they just age out on a later run).
    AND j.last_seen_at < now() - ($1 || ' days')::interval
    AND NOT EXISTS (SELECT 1 FROM job_applications x      WHERE x.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM cover_letters x         WHERE x.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM autofill_history x      WHERE x.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM rejection_submissions x WHERE x.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM resume_edits x          WHERE x.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM resumes x               WHERE x.tailored_for_job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM salary_intercept_events x WHERE x.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM interview_sessions x    WHERE x.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM jobs d                  WHERE d.duplicate_of_id = j.id)
  LIMIT $2
)
DELETE FROM jobs WHERE id IN (SELECT id FROM candidates)
`

export type JobRetentionResult = {
  deleted: number
  batches: number
  olderThanDays: number
}

export async function purgeExpiredInactiveJobs(options?: {
  pool?: Pool
  olderThanDays?: number
  batchSize?: number
  maxBatches?: number
}): Promise<JobRetentionResult> {
  const pool = options?.pool ?? getPostgresPool()
  const olderThanDays = Math.max(7, options?.olderThanDays ?? DEFAULT_DAYS)
  const batchSize = Math.max(100, options?.batchSize ?? DEFAULT_BATCH)
  const maxBatches = Math.max(1, options?.maxBatches ?? DEFAULT_MAX_BATCHES)

  let deleted = 0
  let batches = 0
  for (let i = 0; i < maxBatches; i += 1) {
    const result = await pool.query(DELETE_BATCH_SQL, [olderThanDays, batchSize])
    const n = result.rowCount ?? 0
    if (n === 0) break
    deleted += n
    batches += 1
  }

  if (deleted > 0) await pool.query("VACUUM jobs")

  return { deleted, batches, olderThanDays }
}
