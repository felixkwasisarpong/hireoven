/**
 * Priority scoring for the discover-tenants probe queue.
 *
 * The score is computed IN SQL (so we can ORDER BY + LIMIT without pulling the
 * whole placeholder backlog into Node). CANDIDATE_PRIORITY_ORDER_SQL is the
 * canonical expression used by the cron's claim query; candidatePriorityScore
 * is a JS mirror used only by unit tests (the repo has no test DB).
 *
 * ⚠️ Keep the two in sync — same weights, same order of operations.
 *
 * Weights:
 *   + job_count * 3
 *   + 50  if any of the company's jobs has an apply_url (backsolvable)
 *   + 30  if the domain is real (not an adzuna-/-tenant/-discovered sentinel)
 *   + 20  if discovered_via is an apply-url enrollment
 *   - min(resolution_attempts * 20, 100)         (give up on chronic failures)
 *   - 30  if it failed within the last 24h        (short cooldown after a miss)
 */

/** SQL expression over alias `c` (companies). Mirrors candidatePriorityScore. */
export const CANDIDATE_PRIORITY_ORDER_SQL = `
  (COALESCE(c.job_count, 0) * 3)
  + (CASE WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.company_id = c.id AND j.apply_url IS NOT NULL) THEN 50 ELSE 0 END)
  + (CASE WHEN (c.domain IS NOT NULL
               AND c.domain NOT LIKE 'adzuna-%'
               AND c.domain NOT LIKE '%-tenant'
               AND c.domain NOT LIKE '%-discovered') THEN 30 ELSE 0 END)
  + (CASE WHEN c.discovered_via LIKE 'apply-url:%' THEN 20 ELSE 0 END)
  - LEAST(COALESCE(c.resolution_attempts, 0) * 20, 100)
  - (CASE WHEN c.last_resolution_failed_at > now() - interval '24 hours' THEN 30 ELSE 0 END)
`

export interface CandidatePriorityInput {
  jobCount: number
  hasApplyUrl: boolean
  hasRealDomain: boolean
  discoveredVia: string | null
  resolutionAttempts: number
  /** True when last_resolution_failed_at is within the last 24h. */
  recentlyFailed: boolean
}

export function candidatePriorityScore(c: CandidatePriorityInput): number {
  return (
    Math.max(0, c.jobCount) * 3 +
    (c.hasApplyUrl ? 50 : 0) +
    (c.hasRealDomain ? 30 : 0) +
    (c.discoveredVia?.startsWith("apply-url:") ? 20 : 0) -
    Math.min(Math.max(0, c.resolutionAttempts) * 20, 100) -
    (c.recentlyFailed ? 30 : 0)
  )
}
