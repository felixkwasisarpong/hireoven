/**
 * Discover SmartRecruiters tenants by probing the public Postings API.
 *
 * SmartRecruiters hosts all job boards at jobs.smartrecruiters.com/{slug}.
 * crt.sh finds the shared apex but not per-tenant slugs (shared domain). The
 * public API endpoint is unauthenticated and fast:
 *
 *   GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=5
 *   200 → tenant exists. items[].location.country == "US" for USA check.
 *   400 → invalid slug format.
 *   404 → tenant does not exist.
 *
 * USA confirmation: SmartRecruiters provides a structured `location.country`
 * field — use isUsaCountryCode() for a reliable check.
 *
 * Usage:
 *   npx tsx scripts/discover-smartrecruiters-tenants.ts                  # dry-run
 *   npx tsx scripts/discover-smartrecruiters-tenants.ts --execute
 *   npx tsx scripts/discover-smartrecruiters-tenants.ts --execute --wordlist=full
 *   npx tsx scripts/discover-smartrecruiters-tenants.ts --execute --concurrency=6
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { appendFileSync, writeFileSync, existsSync, readFileSync } from "node:fs"

loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { computeConfidence } from "@/lib/discovery/confidence-score"
import { isUsaCountryCode, isUsaLocation } from "@/lib/discovery/usa-confirm"

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const execute     = args.includes("--execute")
const wordlist    = (args.find(a => a.startsWith("--wordlist="))?.split("=")[1] ?? "seeds") as "seeds" | "full"
const concurrency = Math.max(1, Number.parseInt(args.find(a => a.startsWith("--concurrency="))?.split("=")[1] ?? "6", 10))
const stagger     = Math.max(0, Number.parseInt(args.find(a => a.startsWith("--stagger-ms="))?.split("=")[1] ?? "50", 10))
const cap         = Number.parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "", 10)
const CAP         = Number.isFinite(cap) && cap > 0 ? cap : Infinity
const CHECKPOINT  = args.find(a => a.startsWith("--checkpoint="))?.split("=")[1]
  ?? `/tmp/sr-hits-${Date.now()}.csv`

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error("DATABASE_URL not set — aborting"); process.exit(1) }

const PROBE_TIMEOUT_MS = 10_000
const WAF_WINDOW    = 100
const WAF_THRESHOLD = 0.3

// ─── Slug generation ──────────────────────────────────────────────────────────
// SmartRecruiters slugs are typically CamelCase or lowercase — we generate
// both variants from the candidate company name.

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
}

function slugifyHyphen(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// SmartRecruiters frequently uses CamelCase slugs like "NortonLifeLock"
function toCamelSlug(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "")
}

function generateCandidates(name: string): string[] {
  const variants = new Set<string>()
  const cleaned = name
    .replace(/\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas)\b/gi, " ")
    .replace(/[,()&]/g, " ")
    .trim()

  variants.add(slugify(cleaned))
  variants.add(slugifyHyphen(cleaned))
  variants.add(toCamelSlug(cleaned))
  const firstWord = cleaned.split(/\s+/)[0]
  if (firstWord) variants.add(slugify(firstWord))
  variants.add(slugify(name))

  return Array.from(variants).filter(s => s.length >= 2 && s.length <= 80)
}

// ─── SR API probe ─────────────────────────────────────────────────────────────

type SRLocation = { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string }
type SRPosting  = { id?: string; name?: string; location?: SRLocation }
// SR API uses "content" (not "items") and returns 200 for ALL slugs including
// non-existent ones. A real tenant is identified by totalFound > 0.
type SRResponse = { totalFound?: number; content?: SRPosting[] }

type SRProbeResult =
  | { ok: true;  status: number; totalFound: number; items: SRPosting[] }
  | { ok: false; status: number }

async function probeSR(slug: string): Promise<SRProbeResult> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=5`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(url, {
      headers: {
        "user-agent": "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)",
        accept: "application/json",
      },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (res.status !== 200) return { ok: false, status: res.status }
    const data = (await res.json()) as SRResponse
    const totalFound = data.totalFound ?? 0
    // SR returns 200 for every slug, including non-existent tenants.
    // Only treat as a hit if there are actual active postings.
    if (totalFound === 0) return { ok: false, status: 200 }
    return {
      ok: true,
      status: 200,
      totalFound,
      items: Array.isArray(data.content) ? data.content.slice(0, 5) : [],
    }
  } catch {
    return { ok: false, status: 0 }
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ─── Candidate loading ────────────────────────────────────────────────────────

async function loadCandidateNames(pool: Pool, mode: "seeds" | "full"): Promise<string[]> {
  const seeds = new Set<string>()
  const seedModules = [
    "./data/company-seeds-expansion",
    "./data/company-seeds-f2000-us",
    "./data/company-seeds",
    "./data/enterprise-ats-seeds",
    "./data/tech-brand-seeds",
    "./data/workday-tenant-seeds",
  ]
  for (const mod of seedModules) {
    try {
      const m: Record<string, unknown> = await import(mod)
      for (const value of Object.values(m)) {
        if (!Array.isArray(value)) continue
        for (const row of value as unknown[]) {
          if (Array.isArray(row) && typeof row[0] === "string") seeds.add(row[0])
        }
      }
    } catch { /* skip missing */ }
  }

  if (mode === "full") {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM companies
        WHERE is_active = true
          AND duplicate_of_company_id IS NULL
          AND (ats_type IS NULL OR ats_type != 'smartrecruiters')`
    )
    for (const r of rows) seeds.add(r.name)
  }

  return Array.from(seeds)
}

async function loadKnownSRSlugs(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT ats_identifier FROM companies WHERE ats_type = 'smartrecruiters' AND ats_identifier IS NOT NULL`
  )
  return new Set(rows.map(r => (r.ats_identifier ?? "").toLowerCase()).filter(Boolean))
}

// ─── DB insert via confidence gate ────────────────────────────────────────────

async function insertHit(
  pool: Pool,
  slug: string,
  name: string,
  totalFound: number,
  usaConfirmed: boolean,
  usaJobCount: number,
  fromSeedFile: boolean
) {
  const { score, factors, decision, rejectedReason } = computeConfidence({
    atsMatch:            true,
    apiHttp200:          true,
    jobsFound:           totalFound,
    usaConfirmed,
    usaJobCount,
    fromCuratedSeed:     fromSeedFile,
    fromCommonCrawl:     false,
    isJobDetailPageOnly: false,
    isDnsFailure:        false,
    isLoginRedirect:     false,
    isLikelyTrial:       false,
    isHttpError:         false,
    priorRejections:     0,
  })

  const careersUrl = `https://jobs.smartrecruiters.com/${slug}`
  const domain     = `${slug.toLowerCase()}.smartrecruiters-discovered`

  if (decision === "enroll") {
    return pool.query(
      `INSERT INTO companies
         (name, domain, careers_url, ats_type, ats_identifier,
          is_active, status, freshness_tier, discovered_via, next_harvest_at)
       VALUES ($1,$2,$3,'smartrecruiters',$4,true,'active','tier_2','smartrecruiters-probe',now())
       ON CONFLICT (domain) DO NOTHING
       RETURNING id`,
      [name, domain, careersUrl, slug]
    )
  }

  const nextRetry = decision === "hold"
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null
  return pool.query(
    `INSERT INTO discovered_candidates
       (raw_url, ats_type, ats_identifier, normalized_url, source,
        confidence_score, confidence_factors, rejected_reason, next_retry_at)
     VALUES ($1,'smartrecruiters',$2,$3,'smartrecruiters-probe',$4,$5,$6,$7)
     ON CONFLICT (ats_type, ats_identifier) DO NOTHING`,
    [careersUrl, slug, careersUrl, score, JSON.stringify(factors), rejectedReason, nextRetry]
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  console.log(`[discover-sr] mode=${execute ? "execute" : "dry-run"} wordlist=${wordlist} concurrency=${concurrency} stagger=${stagger}ms`)

  const names      = await loadCandidateNames(pool, wordlist)
  const knownSlugs = await loadKnownSRSlugs(pool)

  const slugToName = new Map<string, string>()
  const seenLower = new Set<string>()
  for (const name of names) {
    for (const slug of generateCandidates(name)) {
      const lower = slug.toLowerCase()
      if (knownSlugs.has(lower)) continue
      if (seenLower.has(lower)) continue
      seenLower.add(lower)
      slugToName.set(slug, name)
    }
  }
  const candidates = Array.from(slugToName.keys()).slice(0, CAP === Infinity ? undefined : CAP)

  type HitRecord = { slug: string; name: string; usaConfirmed: boolean; usaJobCount: number; totalFound: number }
  const previouslyFound = new Map<string, HitRecord>()
  if (existsSync(CHECKPOINT)) {
    const csv = readFileSync(CHECKPOINT, "utf8").split("\n").slice(1)
    for (const line of csv) {
      const parts = line.split(",")
      const slug = parts[0]?.trim()
      if (!slug) continue
      previouslyFound.set(slug, {
        slug, name: parts[1]?.trim() ?? slug,
        usaConfirmed: parts[2]?.trim() === "true",
        usaJobCount: Number.parseInt(parts[3]?.trim() ?? "0", 10) || 0,
        totalFound: Number.parseInt(parts[4]?.trim() ?? "0", 10) || 0,
      })
    }
    console.log(`[discover-sr] resuming from ${CHECKPOINT} (${previouslyFound.size} prior hits)`)
  } else {
    writeFileSync(CHECKPOINT, "slug,name,usa_confirmed,usa_count,total_found\n")
  }

  console.log(`[discover-sr] names=${names.length} known=${knownSlugs.size} candidates=${candidates.length}`)
  console.log(`[discover-sr] checkpoint: ${CHECKPOINT}`)

  const limiter = pLimit(concurrency)
  let processed = 0
  let hits = previouslyFound.size
  let timeouts = 0
  let blocked = 0
  let aborted = false
  const recentStatuses: number[] = []
  const newHits = new Map<string, HitRecord>(previouslyFound)

  await Promise.all(
    candidates.map(slug =>
      limiter(async () => {
        if (aborted || previouslyFound.has(slug)) return
        if (stagger > 0) await sleep(stagger)

        processed++
        const result = await probeSR(slug)

        recentStatuses.push(result.status)
        if (recentStatuses.length > WAF_WINDOW) recentStatuses.shift()
        const wafLike = recentStatuses.filter(s => s === 403 || s === 429 || (s >= 500 && s < 600)).length
        if (recentStatuses.length === WAF_WINDOW && wafLike / WAF_WINDOW > WAF_THRESHOLD && !aborted) {
          aborted = true
          console.warn(`\n[discover-sr] ⚠ WAF pattern (${wafLike}/${WAF_WINDOW}) — aborting. Resume with --checkpoint=${CHECKPOINT}`)
          return
        }

        if (!result.ok) {
          if (result.status === 0) timeouts++
          if (result.status === 403 || result.status === 429) blocked++
          if (processed % 250 === 0) console.log(`  progress: ${processed}/${candidates.length} hits=${hits} timeouts=${timeouts} blocked=${blocked}`)
          return
        }

        hits++
        const name = slugToName.get(slug) ?? slug
        let usaJobCount = 0
        for (const item of result.items) {
          const byCountry = isUsaCountryCode(item.location?.country)
          const byLoc     = isUsaLocation(item.location?.fullLocation ?? item.location?.city)
          const byRemote  = item.location?.remote === true
          if (byCountry || byLoc || byRemote) usaJobCount++
        }

        const rec: HitRecord = {
          slug, name,
          usaConfirmed: usaJobCount > 0,
          usaJobCount,
          totalFound: result.totalFound,
        }
        newHits.set(slug, rec)
        appendFileSync(CHECKPOINT, `${slug},${name.replace(/,/g, ";")},${rec.usaConfirmed},${usaJobCount},${result.totalFound}\n`)

        if (processed % 100 === 0) console.log(`  progress: ${processed}/${candidates.length} hits=${hits} timeouts=${timeouts}`)
      })
    )
  )

  console.log(`\n[discover-sr] probed=${processed} hits=${hits} timeouts=${timeouts} blocked=${blocked}${aborted ? " (ABORTED)" : ""}`)

  if (!execute) {
    console.log("\nDry-run. Use --execute to write to DB. Sample hits:")
    for (const h of Array.from(newHits.values()).slice(0, 20)) {
      console.log(`  ${h.slug.padEnd(35)} usa=${h.usaConfirmed} total=${h.totalFound}  (${h.name})`)
    }
    await pool.end()
    return
  }

  let inserted = 0
  let held = 0
  let rejected = 0
  for (const rec of newHits.values()) {
    const fromSeedFile = slugToName.has(rec.slug)
    try {
      const { decision } = computeConfidence({
        atsMatch: true, apiHttp200: true, jobsFound: rec.totalFound,
        usaConfirmed: rec.usaConfirmed, usaJobCount: rec.usaJobCount,
        fromCuratedSeed: fromSeedFile, fromCommonCrawl: false,
        isJobDetailPageOnly: false, isDnsFailure: false,
        isLoginRedirect: false, isLikelyTrial: false, isHttpError: false,
        priorRejections: 0,
      })
      const r = await insertHit(pool, rec.slug, rec.name, rec.totalFound, rec.usaConfirmed, rec.usaJobCount, fromSeedFile)
      if (decision === "enroll" && r.rowCount && r.rowCount > 0) inserted++
      else if (decision === "hold") held++
      else rejected++
    } catch (err) {
      console.warn(`[discover-sr] insert failed for ${rec.slug}: ${err instanceof Error ? err.message : err}`)
    }
  }

  await pool.query(
    `INSERT INTO discovery_runs (channel, candidates_found, candidates_enrolled, candidates_held, candidates_rejected)
     VALUES ('smartrecruiters-probe',$1,$2,$3,$4)`,
    [newHits.size, inserted, held, rejected]
  ).catch(() => { /* non-fatal */ })

  console.log(`\n[discover-sr] enrolled=${inserted} held=${held} rejected=${rejected}`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
