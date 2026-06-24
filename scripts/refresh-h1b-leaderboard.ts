/**
 * Refresh the H-1B Sponsor Leaderboard materialized view.
 *
 * REFRESH ... CONCURRENTLY keeps public reads lock-free (requires the UNIQUE index
 * on company_id + an already-populated view — both established by
 * scripts/migrations/add-h1b-leaderboard-mv.sql).
 *
 * Usage:
 *   npm run refresh:h1b-leaderboard            # dry run — report current MV state
 *   npm run refresh:h1b-leaderboard:execute    # actually refresh
 *
 * Cron (harvester box), matching the discover:* convention:
 *   0 3 * * * flock -n /tmp/hireoven-h1b-leaderboard.lock -c \
 *     'cd $HIREOVEN_REPO && timeout 15m npm run refresh:h1b-leaderboard:execute \
 *     >>/var/log/hireoven/refresh-h1b-leaderboard.log 2>&1'
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

const execute = process.argv.includes("--execute")

async function main() {
  if (!hasPostgresEnv()) {
    console.error("No database configured (DATABASE_URL).")
    process.exit(1)
  }
  const pool = getPostgresPool()
  const ts = new Date().toISOString()

  const before = await pool.query<{ n: string; refreshed_at: string | null }>(
    "SELECT COUNT(*)::text n, MAX(refreshed_at)::text refreshed_at FROM h1b_leaderboard_mv"
  )
  console.log(
    `[${ts}] h1b_leaderboard_mv: ${Number(before.rows[0]?.n ?? 0).toLocaleString()} rows, last refreshed ${before.rows[0]?.refreshed_at ?? "never"}`
  )

  if (!execute) {
    console.log("[dry run] pass --execute to REFRESH ... CONCURRENTLY.")
    await pool.end()
    return
  }

  const start = Date.now()
  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY h1b_leaderboard_mv")
  const after = await pool.query<{ n: string }>(
    "SELECT COUNT(*)::text n FROM h1b_leaderboard_mv"
  )
  console.log(
    `[${new Date().toISOString()}] refreshed ${Number(after.rows[0]?.n ?? 0).toLocaleString()} rows in ${((Date.now() - start) / 1000).toFixed(1)}s`
  )
  await pool.end()
}

main().catch((err) => {
  console.error("refresh-h1b-leaderboard failed:", err)
  process.exit(1)
})
