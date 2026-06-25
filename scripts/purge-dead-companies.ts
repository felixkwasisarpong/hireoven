/**
 * Hard-delete dead-weight companies that bloat the table: inactive, never produced a
 * single job, not an H-1B sponsor, already probed for an ATS/careers page. Keeps the
 * working set + all visa data.
 *
 *   npx tsx scripts/purge-dead-companies.ts            # dry-run (count + sample)
 *   npx tsx scripts/purge-dead-companies.ts --execute  # delete, keyset-batched
 *
 * FK safety (see `\d companies` referencing constraints):
 *   - jobs/watchlist/crawl_logs/etc. are ON DELETE CASCADE — the NOT EXISTS jobs
 *     guard guarantees no real job is ever cascaded away; the rest are dead children.
 *   - h1b_records is NO ACTION (blocks delete) — excluded explicitly.
 *   - everything else is SET NULL — self-heals.
 */
import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

const EXECUTE = process.argv.includes("--execute")
const BATCH = 500

// Dead-weight predicate with hard KEEP guards.
const PRED = `
  NOT is_active
  AND last_job_seen_at IS NULL
  AND COALESCE(sponsors_h1b, false) = false
  AND (ats_probe_attempted_at IS NOT NULL OR careers_discovery_attempted_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.company_id = companies.id)
  AND NOT EXISTS (SELECT 1 FROM h1b_records hr WHERE hr.company_id = companies.id)
`

async function main() {
  const { getPostgresPool } = await import("@/lib/postgres/server")
  const pool = getPostgresPool()
  const stamp = () => new Date().toISOString()

  const { rows: [{ c }] } = await pool.query<{ c: number }>(`SELECT count(*)::int c FROM companies WHERE ${PRED}`)
  const sample = await pool.query<{ name: string; domain: string | null }>(
    `SELECT name, domain FROM companies WHERE ${PRED} ORDER BY created_at LIMIT 10`
  )
  const { rows: [{ tot }] } = await pool.query<{ tot: number }>(`SELECT count(*)::int tot FROM companies`)

  console.log(`[${stamp()}] target rows: ${c} of ${tot} total companies (${(100 * c / tot).toFixed(1)}%)`)
  console.log("sample:", sample.rows.map((r) => `${r.name} (${r.domain ?? "—"})`).join(", "))

  if (!EXECUTE) {
    console.log("dry-run — pass --execute to delete.")
    return
  }

  let deleted = 0
  for (;;) {
    const r = await pool.query(
      `DELETE FROM companies WHERE id IN (SELECT id FROM companies WHERE ${PRED} LIMIT ${BATCH})`
    )
    deleted += r.rowCount ?? 0
    if (!r.rowCount) break
    console.log(`[${stamp()}] deleted ${deleted}/${c}…`)
  }
  console.log(`[${stamp()}] done. hard-deleted ${deleted} companies.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
