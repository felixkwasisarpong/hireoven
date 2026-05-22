/**
 * F2000 US gap-fill — discovers the real careers URL per company before insert.
 *
 * Flow per seed:
 *   1. If the existing careers_url responds 200 with career signals → keep it.
 *   2. Else run discoverCareersUrl(domain) with the original path inserted at
 *      the front of the probe list. Use the highest-confidence URL.
 *   3. If discovery returns nothing ≥ medium, keep the original guess
 *      (the live crawler / Playwright fallback will validate at crawl time).
 *
 * Safety:
 *   - DRY RUN by default; pass --execute to write.
 *   - Dedupes by domain, skips placeholders, skips domains already in DB.
 *
 * Usage:
 *   npx tsx scripts/seed-f2000-us-with-discovery.ts                # dry run
 *   npx tsx scripts/seed-f2000-us-with-discovery.ts --execute      # write
 *   npx tsx scripts/seed-f2000-us-with-discovery.ts --concurrency=12
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import fs from "node:fs"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"
import { detectAtsFromUrl } from "../lib/companies/detect-ats"
import {
  discoverCareersUrl,
  scoreCareersUrl,
  type DiscoveryProbe,
} from "../lib/companies/careers-url-discovery"
import { F2000_US_GAP_FILL_ROWS } from "./data/company-seeds-f2000-us"

const execute = process.argv.includes("--execute")
const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="))
const CONCURRENCY = Number(concurrencyArg?.split("=")[1]) || 12
const PLACEHOLDER = new Set(["REMOVED-PLACEHOLDER", "REMOVED-PLACEHOLDER-2"])
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

type Seed = {
  name: string
  domain: string
  guess_url: string
  industry: string
  size: string
}

type Resolved = Seed & {
  final_url: string
  source: "guess_verified" | "discovered" | "guess_fallback"
  confidence: "high" | "medium" | "low" | "none"
  reason: string
  ats_type: string | null
  ats_identifier: string | null
}

function buildSeeds(): Seed[] {
  const byDomain = new Map<string, Seed>()
  for (const [name, domain, guess_url, industry, size] of F2000_US_GAP_FILL_ROWS) {
    if (PLACEHOLDER.has(domain)) continue
    const d = domain.toLowerCase().trim()
    if (!d || d.includes(" ")) continue
    byDomain.set(d, { name, domain: d, guess_url, industry, size })
  }
  return [...byDomain.values()]
}

async function fetchHtml(url: string, timeoutMs = 10000): Promise<{ ok: boolean; status: number | null; html: string | null }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,*/*;q=0.7",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    let html: string | null = null
    try {
      html = await res.text()
    } catch {}
    return { ok: res.ok, status: res.status, html }
  } catch {
    return { ok: false, status: null, html: null }
  } finally {
    clearTimeout(t)
  }
}

const probe: DiscoveryProbe = async ({ url, signal }) => {
  if (signal?.aborted) return { ok: false, status: null, html: null }
  return fetchHtml(url)
}

function hasCareerSignal(html: string | null): boolean {
  if (!html) return false
  return /(job|career|position|opening|opportunit|requisition|vacanc|hiring|apply now)/i.test(html.toLowerCase())
}

async function resolveOne(seed: Seed): Promise<Resolved> {
  // Step 1: try the guess. If it's a 200 with career signal, accept it.
  const verify = await fetchHtml(seed.guess_url)
  if (verify.ok && hasCareerSignal(verify.html)) {
    const detected = detectAtsFromUrl(seed.guess_url)
    return {
      ...seed,
      final_url: seed.guess_url,
      source: "guess_verified",
      confidence: scoreCareersUrl(seed.guess_url).confidence,
      reason: "guess_200_with_career_signal",
      ats_type: detected?.atsType ?? null,
      ats_identifier: detected?.atsIdentifier ?? null,
    }
  }

  // Step 2: discover. Put the guess path at the front, then defaults. Drop "/"
  // so the apex homepage can't be picked up as a "careers page" just because
  // it has footer links to an ATS host.
  const guessPath = (() => {
    try {
      const p = new URL(seed.guess_url).pathname
      return p && p !== "/" ? p : null
    } catch {
      return null
    }
  })()
  const pathSet = new Set<string>(
    [
      guessPath,
      "/careers",
      "/jobs",
      "/careers/jobs",
      "/about/careers",
      "/about/jobs",
      "/company/careers",
      "/company/jobs",
      "/work-with-us",
      "/join-us",
      "/open-positions",
    ].filter((p): p is string => Boolean(p))
  )

  const discovered = await discoverCareersUrl({
    domain: seed.domain,
    probe,
    paths: [...pathSet],
  })

  // Guard: even if the classifier returns "high" (e.g. ats_host_link on a
  // page that happens to link to an ATS from its footer), insist on a careers
  // keyword in the actual pathname before considering it a real careers URL.
  const CAREERS_PATH_RE = /\/(careers?|jobs?|positions?|opportunit|openings?|work-with-us|join(?:-us)?)\b/i
  const discoveredPathHasKeyword = (() => {
    try {
      return CAREERS_PATH_RE.test(new URL(discovered.url).pathname)
    } catch {
      return false
    }
  })()

  if (
    (discovered.confidence === "high" || discovered.confidence === "medium") &&
    discoveredPathHasKeyword
  ) {
    const detected = detectAtsFromUrl(discovered.url)
    return {
      ...seed,
      final_url: discovered.url,
      source: "discovered",
      confidence: discovered.confidence,
      reason: discovered.reason,
      ats_type: detected?.atsType ?? null,
      ats_identifier: detected?.atsIdentifier ?? null,
    }
  }

  // Step 3: fall back to guess. Crawler/Playwright will retry at crawl time.
  const detected = detectAtsFromUrl(seed.guess_url)
  return {
    ...seed,
    final_url: seed.guess_url,
    source: "guess_fallback",
    confidence: "low",
    reason: discovered.reason || `discovery_${discovered.confidence}`,
    ats_type: detected?.atsType ?? null,
    ats_identifier: detected?.atsIdentifier ?? null,
  }
}

async function runPool<T, R>(items: T[], n: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const queue = [...items]
  const out: R[] = []
  let done = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) {
        const next = queue.shift()
        if (!next) break
        const r = await worker(next)
        out.push(r)
        done++
        if (done % 25 === 0) console.log(`  resolved ${done}/${items.length}`)
      }
    })
  )
  return out
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("Missing DATABASE_URL in .env.local")
    process.exit(1)
  }
  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  // Build candidate seed list, drop ones whose domain already exists in DB.
  const allSeeds = buildSeeds()
  const { rows: existing } = await pool.query<{ domain: string }>(
    "SELECT domain FROM companies WHERE domain = ANY($1::text[])",
    [allSeeds.map((s) => s.domain)]
  )
  const existingSet = new Set(existing.map((r) => r.domain))
  const seeds = allSeeds.filter((s) => !existingSet.has(s.domain))

  console.log(`Seeds total: ${allSeeds.length}`)
  console.log(`Already in DB: ${allSeeds.length - seeds.length}`)
  console.log(`To resolve + insert: ${seeds.length}\n`)

  const resolved = await runPool(seeds, CONCURRENCY, resolveOne)

  const bySource = {
    guess_verified: resolved.filter((r) => r.source === "guess_verified").length,
    discovered: resolved.filter((r) => r.source === "discovered").length,
    guess_fallback: resolved.filter((r) => r.source === "guess_fallback").length,
  }
  console.log(`\n=== Resolution summary ===`)
  console.log(`  guess_verified (kept original) ..... ${bySource.guess_verified}`)
  console.log(`  discovered (replaced with better) .. ${bySource.discovered}`)
  console.log(`  guess_fallback (no better found) ... ${bySource.guess_fallback}`)
  console.log(`  total ............................... ${resolved.length}`)

  const reportPath = "/tmp/seed-resolve.json"
  fs.writeFileSync(reportPath, JSON.stringify(resolved, null, 2))
  console.log(`Full report: ${reportPath}`)

  if (!execute) {
    console.log(`\n--- DRY RUN — sample of resolutions ---`)
    for (const r of resolved.slice(0, 12)) {
      console.log(
        `  [${r.source.padEnd(15)}] ${r.domain.padEnd(28)} → ${r.final_url}${
          r.final_url !== r.guess_url ? `   (was: ${r.guess_url})` : ""
        }`
      )
    }
    if (resolved.length > 12) console.log(`  … and ${resolved.length - 12} more`)
    console.log(`\nDry run only. Re-run with --execute to write to DB.`)
    await pool.end()
    return
  }

  let inserted = 0
  for (const r of resolved) {
    const res = await pool.query(
      `INSERT INTO companies
         (name, domain, careers_url, logo_url, industry, size, ats_type, ats_identifier,
          is_active, sponsors_h1b, sponsorship_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,false,35)
       ON CONFLICT (domain) DO NOTHING
       RETURNING id`,
      [
        r.name,
        r.domain,
        r.final_url,
        companyLogoUrlFromDomain(r.domain, "google-favicon"),
        r.industry,
        r.size,
        r.ats_type,
        r.ats_identifier,
      ]
    )
    if (res.rowCount && res.rowCount > 0) inserted++
  }
  console.log(`\nDone. Inserted ${inserted} new company rows.`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
