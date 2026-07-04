import type { Pool } from "pg"
import { getPostgresPool } from "@/lib/postgres/server"

/**
 * Dead-board self-cleaning.
 *
 * Companies with an ATS get crawled every cycle. Some boards die — they return
 * nothing crawl after crawl. Job-retention deletes their stale jobs, leaving a
 * job-less company we keep crawling forever. This marks those dead (or deletes
 * them) so the harvester stops wasting cycles on them.
 *
 * A company qualifies when it is harvestable (ats_type set), was once live
 * (`last_job_seen_at IS NOT NULL` — a board that has never produced a job is
 * never retired here), has been crawled-empty repeatedly (`minEmptyCrawls`
 * floor), has ZERO active jobs, and nothing has been seen for it in
 * `inactiveDays` days. Visa sponsors and anything with h1b_records are always
 * preserved.
 *
 * mode='dead' (default): set status='dead' + is_active=false. The harvester
 *   claim query skips status='dead', and enrollTenantAsCompany won't resurrect a
 *   dead row — so the crawl stops permanently with no re-discovery churn, and
 *   it's reversible. `status IS DISTINCT FROM 'dead'` in the predicate means
 *   already-dead rows drop out, so the batch loop terminates.
 * mode='delete': hard-delete (jobs.company_id is ON DELETE CASCADE, but these
 *   companies have no jobs, so ~nothing cascades).
 */

const DEFAULT_MIN_EMPTY = Math.max(
  3,
  Number.parseInt(process.env.PURGE_DEAD_MIN_EMPTY_CRAWLS ?? "20", 10),
)
const DEFAULT_INACTIVE_DAYS = Math.max(
  7,
  Number.parseInt(process.env.PURGE_DEAD_INACTIVE_DAYS ?? "30", 10),
)
const DEFAULT_BATCH = Math.max(50, Number.parseInt(process.env.PURGE_DEAD_BATCH ?? "500", 10))
const DEFAULT_MAX_BATCHES = Math.max(1, Number.parseInt(process.env.PURGE_DEAD_MAX_BATCHES ?? "20", 10))

export type PurgeDeadMode = "dead" | "delete"

// $1 = min empty-crawl streak, $2 = inactive days. (Batch SQL adds $3 = limit.)
//
// `last_job_seen_at IS NOT NULL` is the "was it ever actually alive?" guard:
// the harvester sets that column only on a crawl that returned ≥1 job (see
// run-harvest resetting consecutive_empty_crawls alongside it). So we only ever
// retire boards that were LIVE and then died — a board that has never once
// produced a job (every fresh discovery, e.g. Common-Crawl-seeded Workday/Oracle
// tenants still crawling in, or a real employer that currently has 0 open reqs)
// is never marked dead here, no matter how many empty crawls it racks up. The
// trade-off is we keep crawling never-confirmed boards, but the harvester's
// freshness tiers already back those off, and it's the price of not killing a
// real employer we simply caught at a quiet moment.
const PREDICATE = `
  ats_type IS NOT NULL
  AND status IS DISTINCT FROM 'dead'
  AND COALESCE(sponsors_h1b, false) = false
  AND last_job_seen_at IS NOT NULL
  AND COALESCE(consecutive_empty_crawls, 0) >= $1
  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.company_id = companies.id AND j.is_active = true)
  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.company_id = companies.id AND j.last_seen_at >= now() - ($2 || ' days')::interval)
  AND NOT EXISTS (SELECT 1 FROM h1b_records hr WHERE hr.company_id = companies.id)
`

function batchSql(mode: PurgeDeadMode): string {
  const select = `SELECT id FROM companies WHERE ${PREDICATE} LIMIT $3`
  return mode === "dead"
    ? `UPDATE companies SET status='dead', is_active=false, next_harvest_at=NULL, updated_at=now()
        WHERE id IN (${select})`
    : `DELETE FROM companies WHERE id IN (${select})`
}

export type PurgeDeadResult = {
  affected: number
  batches: number
  mode: PurgeDeadMode
  minEmptyCrawls: number
  inactiveDays: number
}

export async function countDeadCrawledCompanies(
  pool: Pool,
  minEmptyCrawls = DEFAULT_MIN_EMPTY,
  inactiveDays = DEFAULT_INACTIVE_DAYS,
): Promise<number> {
  const { rows } = await pool.query<{ c: number }>(
    `SELECT count(*)::int c FROM companies WHERE ${PREDICATE}`,
    [minEmptyCrawls, inactiveDays],
  )
  return rows[0]?.c ?? 0
}

export async function purgeDeadCrawledCompanies(options?: {
  pool?: Pool
  mode?: PurgeDeadMode
  minEmptyCrawls?: number
  inactiveDays?: number
  batchSize?: number
  maxBatches?: number
}): Promise<PurgeDeadResult> {
  const pool = options?.pool ?? getPostgresPool()
  const mode = options?.mode ?? ((process.env.PURGE_DEAD_MODE as PurgeDeadMode) || "dead")
  const minEmptyCrawls = Math.max(3, options?.minEmptyCrawls ?? DEFAULT_MIN_EMPTY)
  const inactiveDays = Math.max(7, options?.inactiveDays ?? DEFAULT_INACTIVE_DAYS)
  const batchSize = Math.max(50, options?.batchSize ?? DEFAULT_BATCH)
  const maxBatches = Math.max(1, options?.maxBatches ?? DEFAULT_MAX_BATCHES)

  const sql = batchSql(mode === "delete" ? "delete" : "dead")
  let affected = 0
  let batches = 0
  for (let i = 0; i < maxBatches; i += 1) {
    const result = await pool.query(sql, [minEmptyCrawls, inactiveDays, batchSize])
    const n = result.rowCount ?? 0
    if (n === 0) break
    affected += n
    batches += 1
  }

  return { affected, batches, mode: mode === "delete" ? "delete" : "dead", minEmptyCrawls, inactiveDays }
}
