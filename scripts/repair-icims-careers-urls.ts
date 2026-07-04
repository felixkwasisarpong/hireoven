/**
 * Repair iCIMS companies whose careers_url is a malformed bare slug
 * (e.g. `https://springswindowfashions/`) instead of the real portal host
 * (`https://careers-springswindowfashions.icims.com/jobs/search`).
 *
 * These rows were imported with ats_type='icims' + ats_identifier=<bare slug>
 * but never resolved to a live subdomain, so every harvest fails with
 * "fetch_error" and the company is effectively un-crawlable.
 *
 * We probe the known iCIMS subdomain patterns (same signal as
 * discover-icims-tenants.ts: 301/302/200 = real tenant) and, on a hit, rewrite
 * careers_url + ats_identifier (the adapter's slug IS the full host) and requeue.
 *
 * Usage:
 *   npx tsx scripts/repair-icims-careers-urls.ts               # dry-run
 *   npx tsx scripts/repair-icims-careers-urls.ts --limit=40    # dry-run, small batch
 *   npx tsx scripts/repair-icims-careers-urls.ts --execute
 *   npx tsx scripts/repair-icims-careers-urls.ts --execute --concurrency=4
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"

loadEnvConfig(process.cwd())

import { Pool } from "pg"

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const concurrency = Math.max(1, Number.parseInt(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? "4", 10))
const capArg = Number.parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "", 10)
const CAP = Number.isFinite(capArg) && capArg > 0 ? capArg : Infinity

const DATABASE_URL = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set — aborting")
  process.exit(1)
}

const PROBE_TIMEOUT_MS = 8_000
const PROBE_ENDPOINT = "/jobs/search?pr=0&in_iframe=1"
// Prefix patterns iCIMS tenants use, most-likely first. Bare host is
// intentionally after "careers-" because the malformed rows are enterprise
// tenants (the bare slug usually 404s; careers-/uscareers- is the real portal).
const PREFIXES = ["careers-", "", "uscareers-", "jobs-", "careersat-"]

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "")
}

// Candidate base slugs for a company: its stored identifier first, then a
// couple of name-derived fallbacks (some identifiers are wrong, not just un-prefixed).
function candidateBases(ident: string | null, name: string): string[] {
  const out = new Set<string>()
  const add = (s: string) => {
    const t = s.trim().toLowerCase()
    if (t.length >= 2 && t.length <= 50) out.add(t)
  }
  if (ident) add(ident.replace(/\.icims\.com$/i, ""))
  const cleaned = name
    .replace(/\b(incorporated|inc\.?|l\.?l\.?c\.?|llp|corp\.?|corporation|ltd\.?|limited|co\.?|company|plc|holdings|group|technologies|technology|solutions|services|systems|the)\b/gi, " ")
    .replace(/[,()&]/g, " ")
    .trim()
  add(slugify(cleaned))
  add(slugify(cleaned.split(/\s+/)[0] ?? ""))
  return Array.from(out)
}

async function probe(host: string): Promise<boolean> {
  const url = `https://${host}${PROBE_ENDPOINT}`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(url, {
      redirect: "manual",
      headers: {
        "user-agent": "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)",
        accept: "text/html",
      },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return res.status === 301 || res.status === 302 || res.status === 200
  } catch {
    return false
  }
}

// Resolve the first working iCIMS host for a company (candidate × prefix).
async function resolveHost(ident: string | null, name: string): Promise<string | null> {
  for (const base of candidateBases(ident, name)) {
    for (const prefix of PREFIXES) {
      const host = `${prefix}${base}.icims.com`
      if (await probe(host)) return host
    }
  }
  return null
}

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
  console.log(`[repair-icims] mode=${execute ? "EXECUTE" : "dry-run"} concurrency=${concurrency}`)

  const { rows } = await pool.query<{ id: string; name: string; careers_url: string; ats_identifier: string | null }>(
    `SELECT id, name, careers_url, ats_identifier
       FROM companies
      WHERE COALESCE(NULLIF(ats_type,''),'') = 'icims'
        AND status = 'active' AND is_active = true
        AND duplicate_of_company_id IS NULL
        -- malformed: host has no dot (bare slug), e.g. https://springswindowfashions/
        AND careers_url ~ '^https?://[^./]+/?$'
      ORDER BY name`
  )
  const targets = CAP === Infinity ? rows : rows.slice(0, CAP)
  console.log(`[repair-icims] malformed icims rows=${rows.length} processing=${targets.length}`)

  const limit = pLimit(concurrency)
  let done = 0
  let fixed = 0
  const misses: string[] = []
  const collisions: string[] = []
  const results = await Promise.all(
    targets.map((c) =>
      limit(async () => {
        const host = await resolveHost(c.ats_identifier, c.name)
        done += 1
        if (done % 100 === 0) console.log(`  progress ${done}/${targets.length} fixed=${fixed}`)
        if (!host) {
          misses.push(c.name)
          return null
        }
        const newUrl = `https://${host}/jobs/search`
        if (execute) {
          try {
            await pool.query(
              `UPDATE companies
                  SET careers_url = $2,
                      ats_identifier = $3,
                      next_harvest_at = now(),
                      last_resolution_attempted_at = now(),
                      last_resolution_failed_at = NULL,
                      consecutive_empty_crawls = 0,
                      updated_at = now()
                WHERE id = $1`,
              [c.id, newUrl, host]
            )
          } catch (e) {
            // Another active company already owns this iCIMS host — this row is a
            // duplicate. Skip (don't crash the batch); leave for dedupe.
            if ((e as { code?: string }).code === "23505") {
              collisions.push(`${c.name} -> ${host}`)
              return null
            }
            throw e
          }
        }
        fixed += 1
        return { name: c.name, from: c.careers_url, to: newUrl }
      })
    )
  )

  const hits = results.filter(Boolean) as Array<{ name: string; from: string; to: string }>
  console.log(`\n[repair-icims] resolved ${hits.length}/${targets.length}  (misses=${misses.length})`)
  for (const h of hits.slice(0, 30)) console.log(`  ✓ ${h.name.slice(0, 28).padEnd(30)} ${h.from}  ->  ${h.to}`)
  if (hits.length > 30) console.log(`  … and ${hits.length - 30} more`)
  if (misses.length) console.log(`\n  unresolved (${misses.length}): ${misses.slice(0, 20).join(", ")}${misses.length > 20 ? " …" : ""}`)
  if (collisions.length) console.log(`\n  duplicate-host collisions skipped (${collisions.length}): ${collisions.slice(0, 15).join(", ")}${collisions.length > 15 ? " …" : ""}`)
  if (!execute) console.log("\nDry-run — re-run with --execute to write.")
  await pool.end()
  process.exit(0)
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e)
  process.exit(1)
})
