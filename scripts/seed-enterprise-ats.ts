/**
 * Probe + seed enterprise ATS tenants (SuccessFactors / Taleo / Oracle Cloud
 * HCM / Workday — whatever the resolver finds). Each row in the seed list is
 * a hint: `[name, domain, wrapper_careers_url, industry, size, extras?]`.
 *
 * For every row we:
 *   1. Run `resolveDirectAtsUrl` on the wrapper URL.
 *   2. Normalize the resolved URL via `normalizeAtsUrl` to get
 *      (provider, identifier, canonical URL).
 *   3. Upsert the company with `careers_url`, `direct_ats_url`, `ats_type`,
 *      and `ats_identifier` already populated — so the harvester can claim it
 *      on the next tick without going through detection.
 *
 * Rows whose resolver returns nothing are skipped (logged, not inserted).
 * This is the discipline that prevents recreating the broken-zero-job set
 * the May 19 cleanup just resolved.
 *
 * Usage:
 *   npx tsx scripts/seed-enterprise-ats.ts                     # dry-run
 *   npx tsx scripts/seed-enterprise-ats.ts --execute           # actually upsert
 *   npx tsx scripts/seed-enterprise-ats.ts --concurrency=10    # probe rate
 *   npx tsx scripts/seed-enterprise-ats.ts --provider=taleo    # filter
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
import { ENTERPRISE_ATS_SEED_ROWS } from "./data/enterprise-ats-seeds"
import type { CompanySize, SeedExtra } from "./data/company-seeds"

loadEnvConfig(process.cwd())

// undici occasionally throws ERR_INVALID_STATE after a fetch body has been
// fully consumed (race between AbortController + stream cleanup on Node 20).
// It's harmless here — the data we needed is already back. Don't crash the
// whole batch over it.
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes("ERR_INVALID_STATE") || msg.includes("Controller is already closed")) {
    return
  }
  console.error("uncaught:", err)
})
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (msg.includes("ERR_INVALID_STATE") || msg.includes("Controller is already closed")) {
    return
  }
  console.error("unhandled rejection:", reason)
})

/**
 * Some company wrapper pages mention competitor / aggregator URLs (e.g. a
 * "General application" link that happens to read `boards.greenhouse.io/...`)
 * — the resolver's regex grabs the first hit, which then mis-tags Boeing as
 * Lockheed's Greenhouse board, etc. Reject suspiciously generic slugs.
 */
const SLUG_BLOCKLIST = new Set([
  "general",
  "embed",
  "test",
  "demo",
  "careers",
  "jobs",
  "apply",
])

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
const providerFilter = flag("provider")?.toLowerCase() ?? null
const concurrency = Math.max(1, Number.parseInt(flag("concurrency") ?? "8", 10))
// Playwright is memory-heavy; cap headless concurrency lower than HTTP.
const headlessConcurrency = Math.max(
  1,
  Number.parseInt(flag("headless-concurrency") ?? "2", 10)
)

type SeedTuple =
  | readonly [string, string, string, string, CompanySize]
  | readonly [string, string, string, string, CompanySize, SeedExtra]

type ResolvedRow = {
  name: string
  domain: string
  industry: string
  size: CompanySize
  extras: SeedExtra
  // From the resolver pass:
  provider: NormalizedAtsProvider | "successfactors" | "taleo" | "oraclecloud" | "icims"
  identifier: string | null
  careersUrl: string
  directAtsUrl: string
  source: string
}

type Skip = {
  name: string
  domain: string
  wrapperUrl: string
  reason: string
}

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
    // Defense against the resolver's regex picking up generic substrings.
    // If the identifier is a known false-positive slug, reject.
    const identLower = normalized.atsIdentifier?.toLowerCase() ?? ""
    if (SLUG_BLOCKLIST.has(identLower)) {
      return {
        resolved: null,
        skip: { name, domain, wrapperUrl, reason: `blocklist_slug:${identLower}` },
      }
    }
    if (providerFilter && resolution.provider !== providerFilter) {
      return {
        resolved: null,
        skip: { name, domain, wrapperUrl, reason: `provider_filtered:${resolution.provider}` },
      }
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
      skip: {
        name,
        domain,
        wrapperUrl,
        reason: `error:${err instanceof Error ? err.message : String(err)}`,
      },
    }
  }
}

async function main() {
  const banner = [
    "",
    "── Seed enterprise ATS tenants ───────────────────────────",
    `  mode:         ${execute ? "EXECUTE (will upsert)" : "DRY RUN"}`,
    `  rows in seed: ${ENTERPRISE_ATS_SEED_ROWS.length}`,
    `  concurrency:  ${concurrency}`,
    `  headless:     ${headless ? `yes (Playwright, concurrency=${headlessConcurrency})` : "no (static fetch only)"}`,
    providerFilter ? `  provider:     ${providerFilter}` : undefined,
    "──────────────────────────────────────────────────────────",
    "",
  ]
    .filter(Boolean)
    .join("\n")
  console.log(banner)

  // Headless cost: Playwright launches Chromium and Step 3 of the resolver
  // navigates the wrapper page. Only spin it up when --headless is set, and
  // cap effective concurrency to the lower of the two budgets so Chromium
  // doesn't OOM the host.
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
    ENTERPRISE_ATS_SEED_ROWS.map((row) =>
      limiter(async () => {
        const result = await resolveOne(row, renderHtml)
        scanned += 1
        if (result.resolved) {
          resolved.push(result.resolved)
          if (verbose) {
            console.log(
              `  ✓ ${result.resolved.name.padEnd(34)} ${result.resolved.provider.padEnd(16)} ${result.resolved.directAtsUrl}`
            )
          }
        } else if (result.skip) {
          skipped.push(result.skip)
          if (verbose) {
            console.log(`  - ${result.skip.name.padEnd(34)} skip: ${result.skip.reason}`)
          }
        }
        if (!verbose && scanned % 10 === 0) {
          process.stdout.write(
            `\r  scanned ${scanned}/${ENTERPRISE_ATS_SEED_ROWS.length}  resolved=${resolved.length}  skipped=${skipped.length}`
          )
        }
      })
    )
  )
  process.stdout.write("\n")

  const byProvider = new Map<string, number>()
  for (const r of resolved) byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + 1)

  console.log(`\nResolved: ${resolved.length}`)
  for (const [provider, count] of [...byProvider.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${provider.padEnd(18)} ${count}`)
  }
  console.log(`Skipped:  ${skipped.length}`)

  // Group skip reasons.
  const byReason = new Map<string, number>()
  for (const s of skipped) {
    const head = s.reason.split(":")[0]
    byReason.set(head, (byReason.get(head) ?? 0) + 1)
  }
  if (byReason.size > 0) {
    console.log(`  by reason:`)
    for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${reason.padEnd(18)} ${count}`)
    }
  }

  if (!execute) {
    console.log("\nSample of first 20 resolved rows:")
    for (const r of resolved.slice(0, 20)) {
      console.log(`  ${r.provider.padEnd(16)} ${r.name.padEnd(34)} ${r.directAtsUrl}`)
    }
    if (skipped.length > 0) {
      console.log("\nSample of first 20 skips:")
      for (const s of skipped.slice(0, 20)) {
        console.log(`  ${s.name.padEnd(34)} ${s.reason}  (${s.wrapperUrl})`)
      }
    }
    console.log("\nDry run complete. Re-run with --execute to upsert.\n")
    return
  }

  if (resolved.length === 0) {
    console.log("\nNo resolved rows. Nothing to insert.\n")
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
          companyLogoUrlFromDomain(r.domain, "google-favicon"),
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

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
