/**
 * Refresh the embed-impression daily rollup MV (Spec 07) that powers widget
 * view counts on the dashboard. Runs on the harvester box, not the web box.
 *
 * embed_events is append-only and indexed, so this is cheap. CONCURRENTLY keeps
 * dashboard reads lock-free (requires the UNIQUE index + an already-populated
 * view — the migration's CREATE populates it). Falls back to a plain REFRESH if
 * the concurrent path can't run yet.
 *
 * Usage:
 *   npx tsx scripts/refresh-embed-events.ts            # dry-run (report only)
 *   npx tsx scripts/refresh-embed-events.ts --execute  # actually refresh
 *
 * Cron (harvester crontab), hourly:
 *   17 * * * * cd $HIREOVEN_REPO && npm run embed:refresh-events:execute \
 *     >>/var/log/hireoven/embed-refresh-events.log 2>&1
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const execute = process.argv.slice(2).includes("--execute")

async function main() {
  const pool = getPostgresPool()
  const stamp = new Date().toISOString()

  const before = await pool
    .query<{ count: string }>("SELECT COUNT(*)::text AS count FROM embed_event_daily_mv")
    .then((r) => Number(r.rows[0]?.count ?? 0))
    .catch(() => -1)

  if (!execute) {
    console.log(`[${stamp}] dry-run: would REFRESH embed_event_daily_mv (current rows: ${before}). Pass --execute to apply.`)
    return
  }

  const start = Date.now()
  try {
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY embed_event_daily_mv")
  } catch (err) {
    // First-ever refresh or missing unique index → fall back to a blocking refresh.
    console.warn(`[${stamp}] concurrent refresh failed, falling back to plain refresh:`, err instanceof Error ? err.message : err)
    await pool.query("REFRESH MATERIALIZED VIEW embed_event_daily_mv")
  }

  const after = await pool
    .query<{ count: string }>("SELECT COUNT(*)::text AS count FROM embed_event_daily_mv")
    .then((r) => Number(r.rows[0]?.count ?? 0))

  console.log(`[${stamp}] refreshed embed_event_daily_mv: ${after} rows in ${Date.now() - start}ms`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[refresh-embed-events] fatal:", err)
    process.exit(1)
  })
