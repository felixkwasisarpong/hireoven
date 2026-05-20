/**
 * Remove active companies that have an `ats_type` set, have been crawled at
 * least once with enough lead time to actually return results, and STILL
 * report 0 jobs. These are almost always broken — wrong careers URL, dead
 * tenant, gated portal, or ATS migration we didn't track.
 *
 * Companion to `prune-low-signal-companies.ts` (which removes inactive
 * placeholder rows). This script targets *active* companies that the
 * harvester knows how to scrape but consistently returns empty.
 *
 * Safe flow:
 *   1. Audit: report counts grouped by ats_type. Always run, no writes.
 *   2. Backup: dump candidates to CSV so a delete can be reversed manually.
 *   3. Delete: only with --execute. Unlinks h1b / lca rows first, then
 *      deletes the company.
 *
 * Eligibility (all must hold):
 *   - is_active = true
 *   - ats_type IS NOT NULL  (we identified the ATS — adapter exists or did)
 *   - COALESCE(job_count, 0) = 0
 *   - last_crawled_at IS NOT NULL
 *   - last_crawled_at < now() - interval '{--min-age-days} days' (default 7)
 *
 * Usage:
 *   npx tsx scripts/remove-broken-ats-zero-job-companies.ts                # dry run
 *   npx tsx scripts/remove-broken-ats-zero-job-companies.ts --execute      # delete
 *   npx tsx scripts/remove-broken-ats-zero-job-companies.ts --min-age-days=14
 *   npx tsx scripts/remove-broken-ats-zero-job-companies.ts --ats=workday  # only one ATS
 *   npx tsx scripts/remove-broken-ats-zero-job-companies.ts --limit=200
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { detectAdapter } from "@/lib/harvester/adapters"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

const execute = process.argv.includes("--execute")
const minAgeDays = Math.max(1, Number.parseInt(flag("min-age-days") ?? "7", 10))
const atsFilter = flag("ats")?.toLowerCase() ?? null
const limit = Number.parseInt(flag("limit") ?? "", 10)
const limitClause = Number.isFinite(limit) && limit > 0 ? `LIMIT ${limit}` : ""
const outPath =
  flag("out") ??
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `broken-ats-zero-job-backup-${new Date().toISOString().slice(0, 10)}.csv`
  )

type Row = {
  id: string
  name: string
  domain: string | null
  ats_type: string | null
  ats_identifier: string | null
  careers_url: string | null
  direct_ats_url: string | null
  job_count: number | null
  last_crawled_at: string | null
  created_at: string | null
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

async function main() {
  const pool = getPool()

  try {
    const where = [
      "is_active = true",
      "ats_type IS NOT NULL",
      "COALESCE(job_count, 0) = 0",
      "last_crawled_at IS NOT NULL",
      `last_crawled_at < now() - interval '${minAgeDays} days'`,
    ]
    const params: unknown[] = []
    if (atsFilter) {
      params.push(atsFilter)
      where.push(`ats_type = $${params.length}`)
    }

    const targetSql = `
      SELECT
        id, name, domain, ats_type, ats_identifier,
        careers_url, direct_ats_url,
        COALESCE(job_count, 0) AS job_count,
        last_crawled_at, created_at
      FROM companies
      WHERE ${where.join("\n        AND ")}
      ORDER BY last_crawled_at ASC, name ASC
      ${limitClause}
    `

    const { rows: rawTargets } = await pool.query<Row>(targetSql, params)
    // Exclude rows whose careers_url already points at a recognised adapter
    // host — these were probably just repaired and the harvester hasn't had
    // a chance to re-crawl them. Deleting them would undo the fix.
    const targets = rawTargets.filter((row) => {
      const url = row.direct_ats_url?.trim() || row.careers_url?.trim()
      if (!url) return true
      return !detectAdapter(url)
    })
    const skippedAsRepaired = rawTargets.length - targets.length
    const ids = targets.map((r) => String(r.id))

    // Group by ats_type for the audit view.
    const byAts = new Map<string, number>()
    for (const row of targets) {
      const ats = row.ats_type ?? "(null)"
      byAts.set(ats, (byAts.get(ats) ?? 0) + 1)
    }

    console.log(
      `\n── Remove broken ATS zero-job companies ──────────────────────`
    )
    console.log(`  mode:             ${execute ? "EXECUTE (will delete)" : "DRY RUN"}`)
    console.log(`  min crawl age:    ${minAgeDays} days`)
    if (atsFilter) console.log(`  ats filter:       ${atsFilter}`)
    if (limitClause) console.log(`  limit:            ${limit}`)
    console.log(`  raw matches:      ${rawTargets.length.toLocaleString()}`)
    if (skippedAsRepaired > 0)
      console.log(`  skipped (repaired URL, awaiting re-crawl): ${skippedAsRepaired.toLocaleString()}`)
    console.log(`  candidates:       ${targets.length.toLocaleString()}`)
    console.log("──────────────────────────────────────────────────────────────")

    if (targets.length === 0) {
      console.log("\nNothing to remove. Exiting.\n")
      return
    }

    console.log("\nBy ATS:")
    for (const [ats, count] of [...byAts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ats.padEnd(18)} ${count.toLocaleString()}`)
    }

    // Spot-check sample.
    console.log("\nSample (oldest crawled first):")
    for (const row of targets.slice(0, 15)) {
      console.log(
        `  ${(row.ats_type ?? "null").padEnd(16)} ${row.name.slice(0, 30).padEnd(30)} ${row.careers_url ?? "(none)"}`
      )
    }

    // Always write the CSV backup so a delete can be reconstructed.
    const header = [
      "id",
      "name",
      "domain",
      "ats_type",
      "ats_identifier",
      "careers_url",
      "direct_ats_url",
      "job_count",
      "last_crawled_at",
      "created_at",
    ]
    const lines = [header.map(csvEscape).join(",")]
    for (const row of targets) {
      lines.push(
        header.map((k) => csvEscape((row as Record<string, unknown>)[k])).join(",")
      )
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, lines.join("\n"))
    console.log(`\n[backup] CSV written to ${outPath}`)

    if (!execute) {
      console.log("\nDry run complete. Re-run with --execute to delete.\n")
      return
    }

    console.log("\nDeleting...")
    await pool.query("BEGIN")
    try {
      // Unlink raw H1B/LCA history first so we don't cascade-delete it.
      const lcaRes = await pool.query(
        `UPDATE lca_records SET company_id = NULL WHERE company_id = ANY($1::uuid[])`,
        [ids]
      )
      const statsRes = await pool.query(
        `UPDATE employer_lca_stats SET company_id = NULL WHERE company_id = ANY($1::uuid[])`,
        [ids]
      )
      const h1bRes = await pool.query(
        `UPDATE h1b_records SET company_id = NULL WHERE company_id = ANY($1::uuid[])`,
        [ids]
      )
      const delRes = await pool.query(
        `DELETE FROM companies WHERE id = ANY($1::uuid[])`,
        [ids]
      )
      await pool.query("COMMIT")
      console.log(
        `[done] deleted=${delRes.rowCount ?? 0} lca_unlinked=${lcaRes.rowCount ?? 0} stats_unlinked=${statsRes.rowCount ?? 0} h1b_unlinked=${h1bRes.rowCount ?? 0}\n`
      )
    } catch (error) {
      await pool.query("ROLLBACK")
      throw error
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
