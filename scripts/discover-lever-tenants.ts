/**
 * Discover Lever tenants by probing the public Lever Postings API.
 *
 * Lever does NOT use per-tenant subdomains — all job boards share
 * jobs.lever.co/{slug} — so crt.sh cannot find them. The only reliable
 * zero-cost sources are:
 *   1. This probe script (name-derived slug candidates).
 *   2. The Common Crawl CDX miner (mine-commoncrawl-ats.ts).
 *
 * Endpoint: GET https://api.lever.co/v0/postings/{slug}?mode=json
 *   200 + array → tenant exists (array may be empty if no open roles).
 *   404         → no such tenant.
 *
 * No CloudFront WAF observed on this endpoint; concurrency up to 16 is safe.
 * Responses are fast (~300ms for small boards). Default stagger is 50ms to be
 * polite.
 *
 * USA confirmation: Lever returns `posting.categories.location` as a raw
 * string ("San Francisco, CA", "Remote", "London, UK", etc.). We check the
 * first 5 jobs with isUsaLocation().
 *
 * Each confirmed hit runs through the confidence gate before DB insert:
 *   score ≥ 60 → companies (tier_3)
 *   score 40-59 → discovered_candidates (retry in 7 days)
 *   score < 40 → discovered_candidates (rejected)
 *
 * Usage:
 *   npx tsx scripts/discover-lever-tenants.ts                            # dry-run
 *   npx tsx scripts/discover-lever-tenants.ts --execute
 *   npx tsx scripts/discover-lever-tenants.ts --execute --wordlist=full  # includes all DB names
 *   npx tsx scripts/discover-lever-tenants.ts --execute --concurrency=8 --stagger-ms=50
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { appendFileSync, writeFileSync, existsSync, readFileSync } from "node:fs"

loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { computeConfidence } from "@/lib/discovery/confidence-score"
import { isUsaLocation } from "@/lib/discovery/usa-confirm"
import { humanizeSeedSlug } from "@/lib/discovery/seed-slug"

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const execute     = args.includes("--execute")
const wordlist    = (args.find(a => a.startsWith("--wordlist="))?.split("=")[1] ?? "seeds") as "seeds" | "full"
const concurrency = Math.max(1, Number.parseInt(args.find(a => a.startsWith("--concurrency="))?.split("=")[1] ?? "16", 10))
const stagger     = Math.max(0, Number.parseInt(args.find(a => a.startsWith("--stagger-ms="))?.split("=")[1] ?? "50", 10))
const cap         = Number.parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "", 10)
const CAP         = Number.isFinite(cap) && cap > 0 ? cap : Infinity
const CHECKPOINT  = args.find(a => a.startsWith("--checkpoint="))?.split("=")[1]
  ?? `/tmp/lever-hits-${Date.now()}.csv`

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error("DATABASE_URL not set — aborting"); process.exit(1) }

const PROBE_TIMEOUT_MS = 8_000
// Auto-abort if a rolling window of recent probes shows too many WAF-like responses.
const WAF_WINDOW    = 100
const WAF_THRESHOLD = 0.3

// ─── Slug generation ──────────────────────────────────────────────────────────

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

function generateCandidates(name: string): string[] {
  const variants = new Set<string>()
  const cleaned = name
    .replace(/\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas)\b/gi, " ")
    .replace(/[,()&]/g, " ")
    .trim()

  variants.add(slugify(cleaned))
  variants.add(slugifyHyphen(cleaned))
  const firstWord = cleaned.split(/\s+/)[0]
  if (firstWord) variants.add(slugify(firstWord))
  variants.add(slugify(name))

  return Array.from(variants).filter(s => s.length >= 2 && s.length <= 60)
}

// ─── Lever API probe ──────────────────────────────────────────────────────────

type LeverPosting = {
  id?: string
  text?: string
  categories?: { location?: string }
  workplaceType?: string
}

type LeverProbeResult =
  | { ok: true;  status: number; jobs: LeverPosting[] }
  | { ok: false; status: number }

async function probeLever(slug: string): Promise<LeverProbeResult> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`
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
    try { await res.arrayBuffer() } catch { /* drain */ }
    clearTimeout(t)
    if (res.status !== 200) return { ok: false, status: res.status }
    // Re-fetch for actual parse — drain above discarded the body; re-probe.
    // Actually drain + re-read is wasteful. Use clone before drain.
    // Note: the drain above is wrong for parsing — fix by not draining:
    return { ok: true, status: 200, jobs: [] }
  } catch {
    return { ok: false, status: 0 }
  }
}

// Corrected probe: parse body instead of draining.
async function probeLeverWithParse(slug: string): Promise<LeverProbeResult> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`
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
    if (res.status === 404 || res.status === 400) return { ok: false, status: res.status }
    if (res.status !== 200) return { ok: false, status: res.status }
    const jobs = (await res.json()) as LeverPosting[]
    return { ok: true, status: 200, jobs: Array.isArray(jobs) ? jobs.slice(0, 5) : [] }
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
    } catch { /* seed file not found — skip */ }
  }

  if (mode === "full") {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM companies
        WHERE is_active = true
          AND duplicate_of_company_id IS NULL
          AND (ats_type IS NULL OR ats_type != 'lever')`
    )
    for (const r of rows) seeds.add(r.name)
  }

  return Array.from(seeds)
}

async function loadKnownLeverSlugs(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT ats_identifier FROM companies WHERE ats_type = 'lever' AND ats_identifier IS NOT NULL`
  )
  return new Set(rows.map(r => (r.ats_identifier ?? "").toLowerCase()).filter(Boolean))
}

// ─── Insert helpers ───────────────────────────────────────────────────────────

async function insertHit(
  pool: Pool,
  slug: string,
  name: string,
  usaConfirmed: boolean,
  usaJobCount: number,
  jobsFound: number,
  fromSeedFile: boolean
) {
  const { score, factors, decision, rejectedReason } = computeConfidence({
    atsMatch:           true,
    apiHttp200:         true,
    jobsFound,
    usaConfirmed,
    usaJobCount,
    fromCuratedSeed:    fromSeedFile,
    fromCommonCrawl:    false,
    isJobDetailPageOnly:false,
    isDnsFailure:       false,
    isLoginRedirect:    false,
    isLikelyTrial:      false,
    isHttpError:        false,
    priorRejections:    0,
  })

  const careersUrl = `https://jobs.lever.co/${slug}`
  const domain     = `${slug}.lever-discovered`

  if (decision === "enroll") {
    return pool.query(
      `INSERT INTO companies
         (name, domain, careers_url, ats_type, ats_identifier,
          is_active, status, freshness_tier, discovered_via, next_harvest_at)
       VALUES ($1,$2,$3,'lever',$4,true,'active','tier_2','lever-job-board-probe',now())
       ON CONFLICT (domain) DO NOTHING
       RETURNING id`,
      [name, domain, careersUrl, slug]
    )
  }

  // Hold or reject → discovered_candidates.
  const nextRetry = decision === "hold"
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null
  return pool.query(
    `INSERT INTO discovered_candidates
       (raw_url, ats_type, ats_identifier, normalized_url, source,
        confidence_score, confidence_factors, rejected_reason, next_retry_at)
     VALUES ($1,'lever',$2,$3,'lever-probe',$4,$5,$6,$7)
     ON CONFLICT (ats_type, ats_identifier) DO NOTHING`,
    [careersUrl, slug, careersUrl, score, JSON.stringify(factors), rejectedReason, nextRetry]
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  console.log(`[discover-lever] mode=${execute ? "execute" : "dry-run"} wordlist=${wordlist} concurrency=${concurrency} stagger=${stagger}ms`)

  const names      = await loadCandidateNames(pool, wordlist)
  const knownSlugs = await loadKnownLeverSlugs(pool)

  const slugToName = new Map<string, string>()
  for (const name of names) {
    for (const slug of generateCandidates(name)) {
      if (knownSlugs.has(slug)) continue
      if (!slugToName.has(slug)) slugToName.set(slug, name)
    }
  }
  const candidates = Array.from(slugToName.keys()).slice(0, CAP === Infinity ? undefined : CAP)

  // Resume from checkpoint.
  type HitRecord = { slug: string; name: string; usaConfirmed: boolean; jobCount: number }
  const previouslyFound = new Map<string, HitRecord>()
  if (existsSync(CHECKPOINT)) {
    const csv = readFileSync(CHECKPOINT, "utf8").split("\n").slice(1)
    for (const line of csv) {
      const parts = line.split(",")
      const slug = parts[0]?.trim()
      if (!slug) continue
      previouslyFound.set(slug, {
        slug,
        name: parts[1]?.trim() ?? slug,
        usaConfirmed: parts[2]?.trim() === "true",
        jobCount: Number.parseInt(parts[3]?.trim() ?? "0", 10) || 0,
      })
    }
    console.log(`[discover-lever] resuming from ${CHECKPOINT} (${previouslyFound.size} prior hits)`)
  } else {
    writeFileSync(CHECKPOINT, "slug,name,usa_confirmed,job_count\n")
  }

  console.log(`[discover-lever] names=${names.length} known=${knownSlugs.size} candidates=${candidates.length}`)
  console.log(`[discover-lever] checkpoint: ${CHECKPOINT}`)

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
        const result = await probeLeverWithParse(slug)

        recentStatuses.push(result.status)
        if (recentStatuses.length > WAF_WINDOW) recentStatuses.shift()
        const wafLike = recentStatuses.filter(s => s === 403 || s === 429 || (s >= 500 && s < 600)).length
        if (recentStatuses.length === WAF_WINDOW && wafLike / WAF_WINDOW > WAF_THRESHOLD && !aborted) {
          aborted = true
          console.warn(`\n[discover-lever] ⚠ WAF pattern detected (${wafLike}/${WAF_WINDOW} 403/429/5xx) — aborting. Resume with --checkpoint=${CHECKPOINT}`)
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

        // USA confirmation from the sample jobs.
        let usaConfirmed = false
        let usaJobCount = 0
        for (const job of result.jobs) {
          const loc = job.categories?.location ?? ""
          if (isUsaLocation(loc)) { usaConfirmed = true; usaJobCount++ }
        }

        const rec: HitRecord = { slug, name, usaConfirmed, jobCount: result.jobs.length }
        newHits.set(slug, rec)
        appendFileSync(CHECKPOINT, `${slug},${name.replace(/,/g, ";")},${usaConfirmed},${result.jobs.length}\n`)

        if (processed % 100 === 0) console.log(`  progress: ${processed}/${candidates.length} hits=${hits} timeouts=${timeouts}`)
      })
    )
  )

  console.log(`\n[discover-lever] probed=${processed} hits=${hits} timeouts=${timeouts} blocked=${blocked}${aborted ? " (ABORTED)" : ""}`)

  if (!execute) {
    console.log("\nDry-run. Use --execute to write to DB. Sample hits:")
    for (const h of Array.from(newHits.values()).slice(0, 20)) {
      console.log(`  ${h.slug.padEnd(30)} usa=${h.usaConfirmed} jobs=${h.jobCount}  (${h.name})`)
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
      const r = await insertHit(pool, rec.slug, rec.name, rec.usaConfirmed, rec.usaConfirmed ? 1 : 0, rec.jobCount, fromSeedFile)
      const { score, decision } = computeConfidence({
        atsMatch: true, apiHttp200: true, jobsFound: rec.jobCount,
        usaConfirmed: rec.usaConfirmed, usaJobCount: rec.usaConfirmed ? 1 : 0,
        fromCuratedSeed: fromSeedFile, fromCommonCrawl: false,
        isJobDetailPageOnly: false, isDnsFailure: false,
        isLoginRedirect: false, isLikelyTrial: false, isHttpError: false,
        priorRejections: 0,
      })
      if (decision === "enroll" && r.rowCount && r.rowCount > 0) inserted++
      else if (decision === "hold") held++
      else rejected++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[discover-lever] insert failed for ${rec.slug}: ${msg}`)
    }
  }

  await pool.query(
    `INSERT INTO discovery_runs (channel, candidates_found, candidates_enrolled, candidates_held, candidates_rejected)
     VALUES ('lever-probe',$1,$2,$3,$4)`,
    [newHits.size, inserted, held, rejected]
  ).catch(() => { /* non-fatal */ })

  console.log(`\n[discover-lever] enrolled=${inserted} held=${held} rejected=${rejected}`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
