/**
 * Read data/builtin-enriched.jsonl (output of scrape-builtin-companies.ts)
 * and insert net-new companies into the DB, running careers-URL discovery
 * on the apex domain before each insert.
 *
 * Reuses the same flow as seed-f2000-us-with-discovery.ts:
 *   1. Read enriched JSONL, drop entries without a domain.
 *   2. Dedupe by domain against existing `companies` table.
 *   3. For each new domain, run discoverCareersUrl(domain).
 *   4. Insert with the best-confidence careers URL; if discovery returns
 *      nothing usable, fall back to https://<domain>/careers.
 *
 * Safety:
 *   - DRY RUN by default; pass --execute to write.
 *   - `--limit=N` to cap insertions (useful for staged rollout).
 *
 * Usage:
 *   npx tsx scripts/seed-builtin-companies.ts
 *   npx tsx scripts/seed-builtin-companies.ts --execute --limit=500
 *   npx tsx scripts/seed-builtin-companies.ts --execute   # all
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"
import { detectAtsFromUrl } from "../lib/companies/detect-ats"
import {
  discoverCareersUrl,
  type DiscoveryProbe,
} from "../lib/companies/careers-url-discovery"

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const skipDiscovery = args.includes("--skip-discovery")
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1]) || 8)
const explicitInput = args.find((a) => a.startsWith("--input="))?.split("=")[1] ?? null
// By default, read both the BuiltIn-enriched file (small but trusted) and the
// slug-probed file (large salvage set). Either alone, when passed via --input.
const inputPaths = explicitInput
  ? [explicitInput]
  : [
      path.join(process.cwd(), "data", "builtin-enriched.jsonl"),
      path.join(process.cwd(), "data", "builtin-probed.jsonl"),
    ].filter((p) => fs.existsSync(p))
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

const BAD_DOMAIN_RE = /^(builtin\.com|linkedin\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|github\.com|crunchbase\.com|glassdoor\.com|angellist\.com|x\.com)$/i

type EnrichedEntry = {
  name: string
  profile_path: string
  brief: string | null
  website: string | null
  domain: string | null
  external_careers_url: string | null
  industry_tags: string[]
  location: string | null
  enriched_at: string
}

type Seed = {
  name: string
  domain: string
  guess_url: string
  industry: string
  location: string | null
}

function readJsonl<T>(p: string): T[] {
  if (!fs.existsSync(p)) {
    console.error(`Missing input: ${p}`)
    process.exit(1)
  }
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T)
}

function pickIndustry(tags: string[]): string {
  // Keep it close to the existing seed style — single coarse bucket.
  const known = [
    "Fintech", "Healthtech", "Edtech", "Biotech", "Cybersecurity", "AI", "Robotics",
    "Cloud", "Software", "Hardware", "eCommerce", "Marketing", "Media", "Gaming",
    "Real Estate", "Logistics", "Manufacturing", "Energy", "Automotive", "Insurance",
  ]
  for (const t of tags) {
    const matched = known.find((k) => t.toLowerCase().includes(k.toLowerCase()))
    if (matched) return matched
  }
  return tags[0] ?? "Technology"
}

function buildSeeds(entries: EnrichedEntry[]): Seed[] {
  const byDomain = new Map<string, Seed>()
  for (const e of entries) {
    if (!e.domain) continue
    const d = e.domain.toLowerCase().trim().replace(/^www\./, "")
    if (!d || d.includes(" ") || BAD_DOMAIN_RE.test(d)) continue
    if (!d.includes(".")) continue
    if (byDomain.has(d)) continue
    byDomain.set(d, {
      name: e.name.trim(),
      domain: d,
      guess_url: `https://${d}/careers`,
      industry: pickIndustry(e.industry_tags ?? []),
      location: e.location,
    })
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
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.7", "accept-language": "en-US,en;q=0.9" },
    })
    let html: string | null = null
    try { html = await res.text() } catch {}
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

const CAREERS_PATH_RE = /\/(careers?|jobs?|positions?|opportunit|openings?|work-with-us|join(?:-us)?)\b/i

async function resolveOne(seed: Seed): Promise<{ seed: Seed; url: string; ats_type: string | null; ats_identifier: string | null; source: "discovered" | "guess" }> {
  const discovered = await discoverCareersUrl({ domain: seed.domain, probe })
  let acceptable = false
  if (discovered.confidence === "high" || discovered.confidence === "medium") {
    try { acceptable = CAREERS_PATH_RE.test(new URL(discovered.url).pathname) } catch { acceptable = false }
  }
  const finalUrl = acceptable ? discovered.url : seed.guess_url
  const det = detectAtsFromUrl(finalUrl)
  return {
    seed,
    url: finalUrl,
    ats_type: det?.atsType ?? null,
    ats_identifier: det?.atsIdentifier ?? null,
    source: acceptable ? "discovered" : "guess",
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
        if (done % 50 === 0) console.log(`  resolved ${done}/${items.length}`)
      }
    })
  )
  return out
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  const entries: EnrichedEntry[] = []
  for (const p of inputPaths) {
    const chunk = readJsonl<EnrichedEntry>(p)
    console.log(`Read ${chunk.length} entries from ${p}`)
    entries.push(...chunk)
  }
  console.log(`Total entries: ${entries.length}`)

  const allSeeds = buildSeeds(entries)
  console.log(`Unique-by-domain candidates: ${allSeeds.length}`)

  const { rows: existing } = await pool.query<{ domain: string }>(
    "SELECT domain FROM companies WHERE domain = ANY($1::text[])",
    [allSeeds.map((s) => s.domain)]
  )
  const existingSet = new Set(existing.map((r) => r.domain))
  const fresh = allSeeds.filter((s) => !existingSet.has(s.domain))
  console.log(`Already in DB: ${allSeeds.length - fresh.length}`)
  console.log(`New to insert: ${fresh.length}`)

  const todo = fresh.slice(0, Number.isFinite(limit) ? limit : fresh.length)
  console.log(`This run (limit=${Number.isFinite(limit) ? limit : "none"}): ${todo.length}\n`)

  const resolved: Array<{ seed: Seed; url: string; ats_type: string | null; ats_identifier: string | null; source: "discovered" | "guess" }> =
    skipDiscovery
      ? todo.map((s) => ({ seed: s, url: s.guess_url, ats_type: null, ats_identifier: null, source: "guess" as const }))
      : await runPool(todo, concurrency, resolveOne)
  const byKind = {
    discovered: resolved.filter((r) => r.source === "discovered").length,
    guess: resolved.filter((r) => r.source === "guess").length,
  }
  console.log(`\nResolution: discovered=${byKind.discovered} guess=${byKind.guess}  (skipDiscovery=${skipDiscovery})`)

  if (!execute) {
    console.log(`\n--- DRY RUN — sample (first 10) ---`)
    for (const r of resolved.slice(0, 10)) {
      console.log(`  [${r.source.padEnd(10)}] ${r.seed.domain.padEnd(35)} ${r.seed.name}  →  ${r.url}`)
    }
    console.log(`\nDry run only. Re-run with --execute to write.`)
    await pool.end()
    return
  }

  let inserted = 0
  for (const r of resolved) {
    const res = await pool.query(
      `INSERT INTO companies
         (name, domain, careers_url, logo_url, industry, ats_type, ats_identifier,
          is_active, status, sponsors_h1b, sponsorship_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,'active',false,35)
       ON CONFLICT (domain) DO NOTHING
       RETURNING id`,
      [
        r.seed.name,
        r.seed.domain,
        r.url,
        companyLogoUrlFromDomain(r.seed.domain, "google-favicon"),
        r.seed.industry,
        r.ats_type,
        r.ats_identifier,
      ]
    )
    if (res.rowCount && res.rowCount > 0) inserted++
  }
  console.log(`\nDone. Inserted ${inserted} new company rows.`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
