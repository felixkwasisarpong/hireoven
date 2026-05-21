/**
 * Probe + seed the tech-brand list. Same machinery as
 * `seed-enterprise-ats.ts`, just pointed at `tech-brand-seeds.ts`.
 *
 * Usage:
 *   npx tsx scripts/seed-tech-brands.ts                           # dry-run
 *   npx tsx scripts/seed-tech-brands.ts --execute
 *   npx tsx scripts/seed-tech-brands.ts --headless --execute      # use Playwright for JS wrappers
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import {
  resolveDirectAtsUrl,
  type RenderHtml,
} from "@/lib/companies/ats-url-resolver"
import {
  normalizeAtsUrl,
  type NormalizedAtsProvider,
} from "@/lib/companies/ats-url-normalization"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"
import { createPlaywrightRenderer } from "@/lib/companies/playwright-render"
import { TECH_BRAND_SEED_ROWS } from "./data/tech-brand-seeds"
import type { CompanySize, SeedExtra } from "./data/company-seeds"

loadEnvConfig(process.cwd())

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
const headless = process.argv.includes("--headless")
const concurrency = Math.max(1, Number.parseInt(flag("concurrency") ?? "6", 10))
const headlessConcurrency = Math.max(
  1,
  Number.parseInt(flag("headless-concurrency") ?? "2", 10)
)

const SLUG_BLOCKLIST = new Set([
  "general",
  "embed",
  "test",
  "demo",
  "careers",
  "jobs",
  "apply",
])

type SeedTuple =
  | readonly [string, string, string, string, CompanySize]
  | readonly [string, string, string, string, CompanySize, SeedExtra]

type ResolvedRow = {
  name: string
  domain: string
  industry: string
  size: CompanySize
  extras: SeedExtra
  provider: NormalizedAtsProvider | "successfactors" | "taleo" | "oraclecloud" | "icims"
  identifier: string | null
  careersUrl: string
  directAtsUrl: string
  source: string
}

type Skip = { name: string; domain: string; wrapperUrl: string; reason: string }

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

async function resolveOne(
  row: SeedTuple,
  renderHtml: RenderHtml | null
): Promise<{ resolved: ResolvedRow | null; skip?: Skip }> {
  const [name, domainRaw, wrapperUrl, industry, size] = row
  const extras: SeedExtra = row.length > 5 ? (row[5] as SeedExtra) : {}
  const domain = domainRaw.toLowerCase()
  try {
    const resolution = await resolveDirectAtsUrl(wrapperUrl, {
      atsType: null,
      companyName: name,
      renderHtml,
    })
    if (!resolution) {
      return { resolved: null, skip: { name, domain, wrapperUrl, reason: "no_resolve" } }
    }
    const normalized = normalizeAtsUrl(resolution.directUrl, { atsType: resolution.provider })
    if (!normalized.shouldPersist) {
      return {
        resolved: null,
        skip: { name, domain, wrapperUrl, reason: `unpersistable:${normalized.reason}` },
      }
    }
    const identLower = normalized.atsIdentifier?.toLowerCase() ?? ""
    if (SLUG_BLOCKLIST.has(identLower)) {
      return { resolved: null, skip: { name, domain, wrapperUrl, reason: `blocklist:${identLower}` } }
    }
    return {
      resolved: {
        name,
        domain,
        industry,
        size,
        extras,
        provider: resolution.provider,
        identifier: normalized.atsIdentifier,
        careersUrl: normalized.normalizedUrl,
        directAtsUrl: normalized.normalizedUrl,
        source: resolution.source,
      },
    }
  } catch (err) {
    return {
      resolved: null,
      skip: { name, domain, wrapperUrl, reason: `error:${err instanceof Error ? err.message : String(err)}` },
    }
  }
}

async function main() {
  console.log(
    [
      "",
      "── Seed tech-brand list ──────────────────────────────────",
      `  mode:         ${execute ? "EXECUTE (will upsert)" : "DRY RUN"}`,
      `  rows in seed: ${TECH_BRAND_SEED_ROWS.length}`,
      `  headless:     ${headless ? `yes (Playwright, c=${headlessConcurrency})` : "no (static fetch only)"}`,
      "──────────────────────────────────────────────────────────",
      "",
    ].join("\n")
  )

  let renderer: { render: RenderHtml; close: () => Promise<void> } | null = null
  if (headless) {
    console.log("Launching Playwright…")
    renderer = await createPlaywrightRenderer()
  }
  try {
    await runProbe(renderer)
  } finally {
    if (renderer) {
      console.log("Closing Playwright…")
      await renderer.close()
    }
  }
}

async function runProbe(
  renderer: { render: RenderHtml; close: () => Promise<void> } | null
): Promise<void> {
  const renderHtml = renderer?.render ?? null
  const effectiveConcurrency = headless ? headlessConcurrency : concurrency
  const limiter = pLimit(effectiveConcurrency)
  const resolved: ResolvedRow[] = []
  const skipped: Skip[] = []
  let scanned = 0

  await Promise.all(
    TECH_BRAND_SEED_ROWS.map((row) =>
      limiter(async () => {
        const result = await resolveOne(row, renderHtml)
        scanned += 1
        if (result.resolved) {
          resolved.push(result.resolved)
          if (verbose) {
            console.log(
              `  ✓ ${result.resolved.name.padEnd(28)} ${result.resolved.provider.padEnd(16)} ${result.resolved.directAtsUrl}`
            )
          }
        } else if (result.skip) {
          skipped.push(result.skip)
          if (verbose) console.log(`  - ${result.skip.name.padEnd(28)} skip: ${result.skip.reason}`)
        }
        if (!verbose && scanned % 5 === 0) {
          process.stdout.write(
            `\r  scanned ${scanned}/${TECH_BRAND_SEED_ROWS.length}  resolved=${resolved.length}  skipped=${skipped.length}`
          )
        }
      })
    )
  )
  process.stdout.write("\n")

  const byProvider = new Map<string, number>()
  for (const r of resolved) byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + 1)

  console.log(`\nResolved: ${resolved.length}`)
  for (const [p, n] of [...byProvider.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(18)} ${n}`)
  }
  console.log(`Skipped:  ${skipped.length}`)
  for (const s of skipped) console.log(`  - ${s.name.padEnd(28)} ${s.reason}`)

  if (!execute) {
    console.log("\nSample resolutions:")
    for (const r of resolved.slice(0, 30)) {
      console.log(`  ${r.provider.padEnd(16)} ${r.name.padEnd(28)} ${r.directAtsUrl}`)
    }
    console.log("\nDry run. Re-run with --execute to upsert.\n")
    return
  }

  if (resolved.length === 0) {
    console.log("\nNothing to upsert.\n")
    return
  }

  const pool = getPool()
  try {
    let inserted = 0
    let updated = 0
    for (const r of resolved) {
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
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11)
         ON CONFLICT (domain) DO UPDATE SET
           name                   = EXCLUDED.name,
           careers_url            = EXCLUDED.careers_url,
           direct_ats_url         = EXCLUDED.direct_ats_url,
           logo_url               = COALESCE(companies.logo_url, EXCLUDED.logo_url),
           industry               = COALESCE(companies.industry, EXCLUDED.industry),
           size                   = COALESCE(companies.size, EXCLUDED.size),
           ats_type               = EXCLUDED.ats_type,
           ats_identifier         = COALESCE(EXCLUDED.ats_identifier, companies.ats_identifier),
           sponsors_h1b           = EXCLUDED.sponsors_h1b,
           sponsorship_confidence = EXCLUDED.sponsorship_confidence,
           is_active              = true,
           next_harvest_at        = LEAST(COALESCE(companies.next_harvest_at, now()), now())
         RETURNING (xmax = 0) AS was_inserted`,
        [
          r.name,
          r.domain,
          r.careersUrl,
          r.directAtsUrl,
          companyLogoUrlFromDomain(r.domain, "logo-dev"),
          r.industry,
          r.size,
          r.provider,
          r.identifier,
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
