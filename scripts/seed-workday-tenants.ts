/**
 * Probe + seed candidate Workday tenants.
 *
 * For each row in `WORKDAY_CANDIDATE_TENANTS`:
 *   1. Enumerate `WORKDAY_CLUSTERS`, calling `resolveWorkdaySite({tenant, wd})`
 *      on each. First cluster that returns a site wins.
 *   2. Verify the resulting slug (`{tenant}:{wd}:{site}`) is not already in
 *      the DB (matched against `companies.ats_identifier`).
 *   3. Upsert the company with full direct_ats_url + ats_type=workday +
 *      ats_identifier set so the harvester can claim it on the next tick.
 *
 * Defaults to dry run. Pass `--execute` to upsert.
 *
 * Usage:
 *   npx tsx scripts/seed-workday-tenants.ts
 *   npx tsx scripts/seed-workday-tenants.ts --execute
 *   npx tsx scripts/seed-workday-tenants.ts --concurrency=4
 *   npx tsx scripts/seed-workday-tenants.ts --verbose
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import { resolveWorkdaySite } from "@/lib/harvester/discovery/workday-resolver"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import {
  WORKDAY_CANDIDATE_TENANTS,
  WORKDAY_CLUSTERS,
} from "./data/workday-tenant-seeds"
import type { CompanySize, SeedExtra } from "./data/company-seeds"

loadEnvConfig(process.cwd())

// undici sometimes throws ERR_INVALID_STATE after a fetch body races with
// AbortController cleanup. Harmless for our use case; don't crash the batch.
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes("ERR_INVALID_STATE") || msg.includes("Controller is already closed")) return
  console.error("uncaught:", err)
})
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (msg.includes("ERR_INVALID_STATE") || msg.includes("Controller is already closed")) return
  console.error("unhandled rejection:", reason)
})

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes("--execute")
const verbose = process.argv.includes("--verbose")
const concurrency = Math.max(1, Number.parseInt(flag("concurrency") ?? "6", 10))
const probeTimeoutMs = Math.max(2_000, Number.parseInt(flag("timeout") ?? "8000", 10))

type Resolved = {
  name: string
  domain: string
  industry: string
  size: CompanySize
  extras: SeedExtra
  tenant: string
  wd: string
  site: string
  source: string
}

type Skip = {
  name: string
  tenant: string
  reason: string
}

async function loadExistingSlugs(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT DISTINCT ats_identifier FROM companies WHERE ats_type='workday' AND ats_identifier IS NOT NULL`
  )
  const slugs = new Set<string>()
  for (const r of rows) {
    if (r.ats_identifier) slugs.add(r.ats_identifier.toLowerCase())
  }
  return slugs
}

async function probeOne(
  row: typeof WORKDAY_CANDIDATE_TENANTS[number]
): Promise<{ resolved: Resolved | null; skip?: Skip }> {
  const [name, tenant, domainRaw, industry, size] = row
  const extras: SeedExtra = row.length > 5 ? (row[5] as SeedExtra) : {}
  const domain = domainRaw.toLowerCase()

  for (const wd of WORKDAY_CLUSTERS) {
    try {
      const result = await resolveWorkdaySite({ tenant, wd, timeoutMs: probeTimeoutMs })
      if (result) {
        return {
          resolved: {
            name,
            domain,
            industry,
            size,
            extras,
            tenant,
            wd,
            site: result.site,
            source: result.source,
          },
        }
      }
    } catch {
      // resolver swallows network errors; keep going
    }
  }
  return { resolved: null, skip: { name, tenant, reason: "no_cluster_resolved" } }
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
  console.log(
    [
      "",
      "── Seed Workday tenants ─────────────────────────────────",
      `  mode:        ${execute ? "EXECUTE (will upsert)" : "DRY RUN"}`,
      `  candidates:  ${WORKDAY_CANDIDATE_TENANTS.length}`,
      `  clusters:    ${WORKDAY_CLUSTERS.length} (${WORKDAY_CLUSTERS.join(",")})`,
      `  concurrency: ${concurrency}`,
      "─────────────────────────────────────────────────────────",
      "",
    ].join("\n")
  )

  const pool = getPool()
  try {
    const existing = await loadExistingSlugs(pool)
    console.log(`Existing Workday tenants in DB: ${existing.size}`)

    const limiter = pLimit(concurrency)
    const resolved: Resolved[] = []
    const skipped: Skip[] = []
    const dupes: Resolved[] = []
    let scanned = 0

    await Promise.all(
      WORKDAY_CANDIDATE_TENANTS.map((row) =>
        limiter(async () => {
          const result = await probeOne(row)
          scanned += 1
          if (result.resolved) {
            const slug = `${result.resolved.tenant}:${result.resolved.wd}:${result.resolved.site}`.toLowerCase()
            if (existing.has(slug)) {
              dupes.push(result.resolved)
              if (verbose) {
                console.log(`  = ${result.resolved.name.padEnd(34)} already in DB (${slug})`)
              }
            } else {
              resolved.push(result.resolved)
              if (verbose) {
                console.log(
                  `  ✓ ${result.resolved.name.padEnd(34)} ${result.resolved.tenant}:${result.resolved.wd}:${result.resolved.site} (${result.resolved.source})`
                )
              }
            }
          } else if (result.skip) {
            skipped.push(result.skip)
            if (verbose) console.log(`  - ${result.skip.name.padEnd(34)} skip: ${result.skip.reason}`)
          }
          if (!verbose && scanned % 5 === 0) {
            process.stdout.write(
              `\r  scanned ${scanned}/${WORKDAY_CANDIDATE_TENANTS.length}  new=${resolved.length} dup=${dupes.length} skip=${skipped.length}`
            )
          }
        })
      )
    )
    process.stdout.write("\n")

    console.log(`\nNew Workday tenants found:    ${resolved.length}`)
    console.log(`Already in DB (dedup'd):      ${dupes.length}`)
    console.log(`Could not resolve:            ${skipped.length}`)

    if (resolved.length > 0) {
      console.log("\nSample of new resolutions:")
      for (const r of resolved.slice(0, 30)) {
        console.log(`  ${r.name.padEnd(34)} ${r.tenant}:${r.wd}:${r.site}`)
      }
    }

    if (!execute) {
      console.log("\nDry run complete. Re-run with --execute to upsert.\n")
      return
    }

    if (resolved.length === 0) {
      console.log("\nNothing new to insert.\n")
      return
    }

    let inserted = 0
    let updated = 0
    for (const r of resolved) {
      const slug = `${r.tenant}:${r.wd}:${r.site}`
      const careersUrl = canonicalCareersUrl("workday", slug)
      if (!careersUrl) {
        console.log(`  [skip-canonical] ${r.name} slug=${slug}`)
        continue
      }
      const sponsors = r.extras.sponsors_h1b ?? false
      const confidence =
        typeof r.extras.sponsorship_confidence === "number"
          ? r.extras.sponsorship_confidence
          : sponsors
            ? 65
            : 35
      const result = await pool.query(
        `INSERT INTO companies
           (name, domain, careers_url, direct_ats_url, logo_url, industry, size,
            ats_type, ats_identifier, is_active, sponsors_h1b, sponsorship_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'workday',$8,true,$9,$10)
         ON CONFLICT (domain) DO UPDATE SET
           name                   = EXCLUDED.name,
           careers_url            = EXCLUDED.careers_url,
           direct_ats_url         = EXCLUDED.direct_ats_url,
           logo_url               = COALESCE(companies.logo_url, EXCLUDED.logo_url),
           industry               = COALESCE(companies.industry, EXCLUDED.industry),
           size                   = COALESCE(companies.size, EXCLUDED.size),
           ats_type               = 'workday',
           ats_identifier         = EXCLUDED.ats_identifier,
           sponsors_h1b           = EXCLUDED.sponsors_h1b,
           sponsorship_confidence = EXCLUDED.sponsorship_confidence,
           is_active              = true,
           next_harvest_at        = LEAST(COALESCE(companies.next_harvest_at, now()), now())
         RETURNING (xmax = 0) AS was_inserted`,
        [
          r.name,
          r.domain,
          careersUrl,
          careersUrl,
          companyLogoUrlFromDomain(r.domain, "google-favicon"),
          r.industry,
          r.size,
          slug,
          sponsors,
          confidence,
        ]
      )
      const wasInserted = (result.rows[0] as { was_inserted: boolean } | undefined)?.was_inserted
      if (wasInserted) inserted += 1
      else updated += 1
    }
    console.log(`\n[done] inserted=${inserted} updated=${updated} total=${resolved.length}\n`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
