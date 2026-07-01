/**
 * Import jobhive's company→ATS→slug dataset into the hireoven `companies` table.
 *
 * jobhive (github.com/kalil0321/ats-scrapers) publishes ~63k companies already
 * mapped to their ATS + slug — the exact thing the harvester's discovery stage
 * spends cycles resolving. This ingests those rows through the harvester's own
 * `enrollTenantAsCompany`, so dedup (by ats pair, then domain) and queueing are
 * identical to organic discovery.
 *
 * SAFETY: dry-run is the default and touches NO database. Nothing is written
 * unless you pass --execute.
 *
 *   npx tsx tools/jobhive-ts/import-companies.ts                 # offline dry-run
 *   npx tsx tools/jobhive-ts/import-companies.ts --check-db      # + read-only net-new estimate
 *   npx tsx tools/jobhive-ts/import-companies.ts --execute       # WRITE (enrolls rows)
 *   npx tsx tools/jobhive-ts/import-companies.ts --ats greenhouse,workday --limit 50
 */

import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { getAdapter, type AtsName } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, "data")

/**
 * jobhive CSV platform → harvester AtsName. Only platforms the harvester can
 * actually crawl are importable; the rest are counted and reported so we know
 * what coverage we'd be leaving on the table (they'd need a new adapter).
 */
const PLATFORM_MAP: Record<string, AtsName | null> = {
  greenhouse: "greenhouse",
  lever: "lever",
  ashby: "ashby",
  workable: "workable",
  smartrecruiters: "smartrecruiters",
  personio: "personio",
  recruitee: "recruitee",
  teamtailor: "teamtailor",
  bamboohr: "bamboohr",
  jazzhr: "jazzhr",
  icims: "icims",
  successfactors: "successfactors",
  taleo: "taleo",
  avature: "avature",
  phenom: "phenom",
  eightfold: "eightfold",
  rippling: "rippling",
  workday: "workday", // ats_identifier derived from the careers URL
  oracle: "oraclecloud", // ats_identifier derived from the careers URL
  // No harvester adapter → NOT importable (would need a new adapter first):
  breezy: null,
  cornerstone: null,
  gem: null,
  pinpoint: null,
  recruiterbox: null,
}

/** Platforms whose ats_identifier must be parsed out of the full careers URL. */
const URL_DERIVED = new Set<AtsName>(["workday", "oraclecloud"])

type CsvRow = { name: string; slug: string; url: string }
function readCsv(platform: string): CsvRow[] {
  const path = join(DATA, `${platform}.csv`)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
  const rows: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",")
    if (parts.length < 2) continue
    const url = parts.length >= 3 ? parts[parts.length - 1] : ""
    const slug = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1]
    const name = parts.slice(0, parts.length - (parts.length >= 3 ? 2 : 1)).join(",")
    rows.push({ name: name.replace(/^"|"$/g, ""), slug: slug.trim(), url: url.trim() })
  }
  return rows
}

type Normalized = {
  platform: string
  atsType: AtsName
  atsIdentifier: string
  careersUrl: string
  name: string
}

/** Turn a CSV row into the (atsType, atsIdentifier, careersUrl) enroll input. */
function normalize(platform: string, atsType: AtsName, row: CsvRow): Normalized | { skip: string } {
  let atsIdentifier = row.slug
  if (URL_DERIVED.has(atsType)) {
    const adapter = getAdapter(atsType)
    const detected = adapter?.detectFromUrl(row.url || row.slug)?.slug
    if (!detected) return { skip: "url_not_parseable" }
    atsIdentifier = detected
  }
  if (!atsIdentifier) return { skip: "empty_slug" }
  const careersUrl = canonicalCareersUrl(atsType, atsIdentifier) ?? row.url
  if (!careersUrl) return { skip: "no_careers_url" }
  return { platform, atsType, atsIdentifier, careersUrl, name: row.name || atsIdentifier }
}

function parseArgs(argv: string[]) {
  const get = (f: string) => {
    const i = argv.indexOf(f)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    execute: argv.includes("--execute"),
    checkDb: argv.includes("--check-db"),
    only: get("--ats")?.split(",").map((s) => s.trim()) ?? null,
    limit: get("--limit") ? Number.parseInt(get("--limit")!, 10) : null,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const platforms = args.only ?? Object.keys(PLATFORM_MAP)

  const importable: Normalized[] = []
  const skipStats: Record<string, number> = {}
  const unsupported: Record<string, number> = {}
  const perPlatform: Record<string, number> = {}

  for (const platform of platforms) {
    const atsType = PLATFORM_MAP[platform]
    const rows = readCsv(platform)
    if (!rows.length) continue
    if (atsType == null) {
      unsupported[platform] = rows.length
      continue
    }
    const limited = args.limit ? rows.slice(0, args.limit) : rows
    for (const row of limited) {
      const n = normalize(platform, atsType, row)
      if ("skip" in n) {
        skipStats[n.skip] = (skipStats[n.skip] ?? 0) + 1
        continue
      }
      importable.push(n)
      perPlatform[platform] = (perPlatform[platform] ?? 0) + 1
    }
  }

  console.log("\n=== jobhive → companies import (DRY RUN) ===\n")
  console.log("Importable (supported ATS), by platform:")
  for (const [p, n] of Object.entries(perPlatform).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(18)} ${String(n).padStart(6)}`)
  }
  console.log(`  ${"—".repeat(24)}`)
  console.log(`  ${"TOTAL importable".padEnd(18)} ${String(importable.length).padStart(6)}\n`)

  if (Object.keys(unsupported).length) {
    const unsupTotal = Object.values(unsupported).reduce((a, b) => a + b, 0)
    console.log(`Unsupported platforms (no harvester adapter) — ${unsupTotal} companies NOT importable:`)
    for (const [p, n] of Object.entries(unsupported).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${p.padEnd(18)} ${String(n).padStart(6)}`)
    }
    console.log()
  }
  if (Object.keys(skipStats).length) {
    console.log("Skipped rows (normalization):")
    for (const [reason, n] of Object.entries(skipStats)) console.log(`  ${reason.padEnd(18)} ${n}`)
    console.log()
  }

  console.log("Sample normalized rows:")
  for (const n of importable.slice(0, 6)) {
    console.log(`  [${n.atsType}] ${n.name} → id="${n.atsIdentifier}" url=${n.careersUrl}`)
  }
  console.log()

  if (args.checkDb || args.execute) {
    const { getPostgresPool } = await import("@/lib/postgres/server")
    const pool = getPostgresPool()

    if (args.checkDb && !args.execute) {
      // Read-only net-new estimate. ONE indexed query per ats_type (uses
      // idx_companies_ats_type) — returns only that platform's rows, no full scan.
      const byAts = new Map<AtsName, Normalized[]>()
      for (const n of importable) {
        if (!byAts.has(n.atsType)) byAts.set(n.atsType, [])
        byAts.get(n.atsType)!.push(n)
      }
      let netNew = 0
      let matched = 0
      console.log("Net-new estimate (read-only):")
      for (const [atsType, rows] of byAts) {
        const res = await pool.query<{ ats_identifier: string }>(
          `SELECT ats_identifier FROM companies WHERE ats_type = $1 AND ats_identifier IS NOT NULL`,
          [atsType],
        )
        const existing = new Set(res.rows.map((r) => r.ats_identifier))
        const fresh = rows.filter((r) => !existing.has(r.atsIdentifier)).length
        netNew += fresh
        matched += rows.length - fresh
        console.log(`  ${atsType.padEnd(18)} ${String(fresh).padStart(6)} new / ${rows.length} total (${existing.size} already in DB)`)
      }
      console.log(`  ${"—".repeat(24)}`)
      console.log(`  net-new ~${netNew}, already-present ~${matched}\n`)
      await pool.end()
      return
    }

    if (args.execute) {
      console.log("!!! EXECUTE MODE — writing to the database. Ctrl-C now to abort. !!!")
      console.log("    (Reminder: check `df -h` on the web box first — bulk inserts can fill disk.)\n")
      const { enrollTenantAsCompany } = await import("@/lib/discovery/enroll-tenant-as-company")
      let created = 0
      let linked = 0
      let failed = 0
      const CONCURRENCY = 6
      let idx = 0
      async function worker() {
        while (idx < importable.length) {
          const n = importable[idx++]
          try {
            const r = await enrollTenantAsCompany(pool, {
              atsType: n.atsType,
              atsIdentifier: n.atsIdentifier,
              confidence: 70,
              sourceType: "jobhive-dataset",
              sourceUrl: n.careersUrl,
              companyNameGuess: n.name,
            })
            if (r.created) created++
            else linked++
          } catch (e) {
            failed++
            if (failed <= 10) console.error(`  fail ${n.atsType}/${n.atsIdentifier}: ${(e as Error).message}`)
          }
          if ((created + linked + failed) % 500 === 0) {
            console.log(`  progress: ${created} created, ${linked} linked, ${failed} failed`)
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      console.log(`\nDone: ${created} created, ${linked} linked/updated, ${failed} failed`)
      await pool.end()
      return
    }
  }

  console.log("Dry run only — no database touched. Re-run with --check-db for a net-new estimate, or --execute to write.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
