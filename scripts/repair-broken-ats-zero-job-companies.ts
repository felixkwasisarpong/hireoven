/**
 * Targeted repair for the same set that `remove-broken-ats-zero-job-companies.ts`
 * flags: active companies that have an `ats_type` set, were crawled at least
 * once, and still report 0 jobs.
 *
 * For each candidate, fetch the careers URL, try to resolve it to a direct
 * ATS URL via `resolveDirectAtsUrl`, and update the row's `careers_url` /
 * `direct_ats_url` / `ats_type` / `ats_identifier` so the next harvest cycle
 * can claim it.
 *
 * Defaults to dry run. Pass `--execute` to actually update.
 *
 * Usage:
 *   npx tsx scripts/repair-broken-ats-zero-job-companies.ts
 *   npx tsx scripts/repair-broken-ats-zero-job-companies.ts --execute
 *   npx tsx scripts/repair-broken-ats-zero-job-companies.ts --min-age-days=3
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { resolveDirectAtsUrl } from "@/lib/companies/ats-url-resolver"
import { normalizeAtsUrl } from "@/lib/companies/ats-url-normalization"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes("--execute")
const minAgeDays = Math.max(1, Number.parseInt(flag("min-age-days") ?? "7", 10))
const atsFilter = flag("ats")?.toLowerCase() ?? null

type Row = {
  id: string
  name: string
  domain: string | null
  ats_type: string | null
  ats_identifier: string | null
  careers_url: string | null
  direct_ats_url: string | null
  last_crawled_at: string | null
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

    const { rows: targets } = await pool.query<Row>(
      `SELECT id, name, domain, ats_type, ats_identifier,
              careers_url, direct_ats_url, last_crawled_at
       FROM companies
       WHERE ${where.join("\n         AND ")}
       ORDER BY last_crawled_at ASC, name ASC`,
      params
    )

    console.log(`\n── Repair broken ATS zero-job companies ──────────────────`)
    console.log(`  mode:        ${execute ? "EXECUTE (will update)" : "DRY RUN"}`)
    console.log(`  candidates:  ${targets.length}`)
    console.log(`──────────────────────────────────────────────────────────────`)

    if (targets.length === 0) {
      console.log("\nNo candidates. Exiting.\n")
      return
    }

    let resolved = 0
    let unchanged = 0
    let failed = 0
    const updates: Array<{
      id: string
      name: string
      old: { careers_url: string | null; ats_type: string | null; ats_identifier: string | null }
      next: { careers_url: string; direct_ats_url: string; ats_type: string; ats_identifier: string | null }
    }> = []

    for (const row of targets) {
      const currentUrl = row.careers_url?.trim() ?? ""
      if (!currentUrl) {
        failed += 1
        console.log(`  [skip-no-url] ${row.name}`)
        continue
      }

      // resolveDirectAtsUrl already short-circuits when the input is already
      // a direct ATS URL — that case will surface as "already_direct" and we
      // just keep what we have.
      const resolution = await resolveDirectAtsUrl(currentUrl, {
        atsType: row.ats_type,
        companyName: row.name,
      })

      if (!resolution) {
        failed += 1
        console.log(`  [no-resolve] ${row.name.padEnd(20)} ${currentUrl}`)
        continue
      }

      const normalized = normalizeAtsUrl(resolution.directUrl, { atsType: resolution.provider })
      if (!normalized.shouldPersist) {
        failed += 1
        console.log(`  [unpersist]  ${row.name.padEnd(20)} → ${resolution.directUrl}`)
        continue
      }

      // If the resolved URL is identical to what we already have (down to a
      // trailing-slash variant), no point updating.
      if (normalized.normalizedUrl === currentUrl && resolution.provider === row.ats_type) {
        unchanged += 1
        console.log(`  [same]       ${row.name.padEnd(20)} (already ${row.ats_type})`)
        continue
      }

      resolved += 1
      updates.push({
        id: row.id,
        name: row.name,
        old: {
          careers_url: row.careers_url,
          ats_type: row.ats_type,
          ats_identifier: row.ats_identifier,
        },
        next: {
          careers_url: normalized.normalizedUrl,
          direct_ats_url: normalized.normalizedUrl,
          ats_type: resolution.provider,
          ats_identifier: normalized.atsIdentifier,
        },
      })
      console.log(
        `  [resolve]    ${row.name.padEnd(20)} ${row.ats_type} → ${resolution.provider} (${resolution.source})\n` +
          `               ${currentUrl}\n            → ${normalized.normalizedUrl}`
      )
    }

    console.log(
      `\nSummary: resolved=${resolved} unchanged=${unchanged} failed=${failed} total=${targets.length}`
    )

    if (!execute) {
      console.log("\nDry run complete. Re-run with --execute to apply updates.\n")
      return
    }

    if (updates.length === 0) {
      console.log("\nNothing to update.\n")
      return
    }

    await pool.query("BEGIN")
    try {
      for (const u of updates) {
        await pool.query(
          `UPDATE companies
              SET careers_url = $2,
                  direct_ats_url = $3,
                  ats_type = $4,
                  ats_identifier = COALESCE($5, ats_identifier),
                  next_harvest_at = now(),
                  updated_at = now()
            WHERE id = $1`,
          [u.id, u.next.careers_url, u.next.direct_ats_url, u.next.ats_type, u.next.ats_identifier]
        )
      }
      await pool.query("COMMIT")
      console.log(`\n[done] updated ${updates.length} rows. They will be re-claimed on the next worker tick.\n`)
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
