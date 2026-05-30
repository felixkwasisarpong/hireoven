/**
 * Discover iCIMS tenants by probing the public job-search page.
 *
 * iCIMS hosts job boards at various subdomain patterns under icims.com:
 *   {slug}.icims.com/jobs/search           — most common
 *   careers-{slug}.icims.com/jobs/search   — large enterprise variant
 *
 * Probe signal (clean, no WAF observed):
 *   301 / 302  →  real tenant
 *   404        →  non-existent
 *
 * iCIMS serves 4,000+ enterprise clients (healthcare, defense, retail, finance).
 * The slug is not always the brand name — we try both the raw company slug and
 * common prefix variants to maximize hit rate.
 *
 * Usage:
 *   npx tsx scripts/discover-icims-tenants.ts               # dry-run
 *   npx tsx scripts/discover-icims-tenants.ts --execute
 *   npx tsx scripts/discover-icims-tenants.ts --execute --wordlist=full
 *   npx tsx scripts/discover-icims-tenants.ts --execute --concurrency=6
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"

loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { computeConfidence } from "@/lib/discovery/confidence-score"

const args        = process.argv.slice(2)
const execute     = args.includes("--execute")
const wordlist    = (args.find(a => a.startsWith("--wordlist="))?.split("=")[1] ?? "seeds") as "seeds" | "full"
const concurrency = Math.max(1, Number.parseInt(args.find(a => a.startsWith("--concurrency="))?.split("=")[1] ?? "6", 10))
const capArg      = Number.parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "", 10)
const CAP         = Number.isFinite(capArg) && capArg > 0 ? capArg : Infinity

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error("DATABASE_URL not set — aborting"); process.exit(1) }

const PROBE_TIMEOUT_MS = 8_000
const PROBE_ENDPOINT   = "/jobs/search?pr=0&in_iframe=1"

// ─── Slug generation ──────────────────────────────────────────────────────────

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "")
}

function slugifyHyphen(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function generateCandidates(name: string): string[] {
  const out = new Set<string>()
  const cleaned = name
    .replace(/\b(incorporated|inc\.?|l\.?l\.?c\.?|llp|corp\.?|corporation|ltd\.?|limited|co\.?|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas)\b/gi, " ")
    .replace(/[,()&]/g, " ").trim()

  const base       = slugify(cleaned)
  const baseHyphen = slugifyHyphen(cleaned)
  const firstWord  = slugify(cleaned.split(/\s+/)[0] ?? "")
  const rawName    = slugify(name)

  for (const s of [base, baseHyphen, firstWord, rawName]) {
    if (s.length >= 2 && s.length <= 50) out.add(s)
  }
  return Array.from(out)
}

// iCIMS subdomain prefix patterns to try per company slug.
// "bare" = {slug}.icims.com, "careers-" = careers-{slug}.icims.com
const PREFIXES = ["", "careers-"]

// ─── Probe ────────────────────────────────────────────────────────────────────

type ProbeHit = { host: string; slug: string }  // full hostname + subdomain slug

async function probeIcims(companySlug: string): Promise<ProbeHit | null> {
  for (const prefix of PREFIXES) {
    const subdomain = `${prefix}${companySlug}`
    const url = `https://${subdomain}.icims.com${PROBE_ENDPOINT}`
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
      // 301/302 = real iCIMS tenant redirecting to canonical URL
      if (res.status === 301 || res.status === 302 || res.status === 200) {
        return { host: `${subdomain}.icims.com`, slug: subdomain }
      }
    } catch {
      // timeout or DNS failure — try next prefix
    }
  }
  return null
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function loadCandidateNames(pool: Pool): Promise<string[]> {
  const seeds = new Set<string>()
  const seedModules = [
    "./data/company-seeds-expansion", "./data/company-seeds-f2000-us",
    "./data/company-seeds", "./data/enterprise-ats-seeds",
    "./data/tech-brand-seeds", "./data/workday-tenant-seeds",
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
    } catch { /* skip */ }
  }
  if (wordlist === "full") {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM companies
        WHERE is_active=true AND duplicate_of_company_id IS NULL
          AND (ats_type IS NULL OR ats_type != 'icims')`
    )
    for (const r of rows) seeds.add(r.name)
  }
  return Array.from(seeds)
}

async function loadKnownSlugs(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT ats_identifier FROM companies WHERE ats_type='icims' AND ats_identifier IS NOT NULL`
  )
  return new Set(rows.map(r => (r.ats_identifier ?? "").toLowerCase()).filter(Boolean))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  console.log(`[discover-icims] mode=${execute ? "execute" : "dry-run"} wordlist=${wordlist} concurrency=${concurrency}`)

  const names      = await loadCandidateNames(pool)
  const knownSlugs = await loadKnownSlugs(pool)

  // Build deduped candidate map: company slug → company name.
  // Each name generates multiple company slugs; each slug gets tried with
  // multiple URL prefixes inside probeIcims().
  const slugToName = new Map<string, string>()
  const seenLower  = new Set<string>()
  for (const name of names) {
    for (const slug of generateCandidates(name)) {
      const lower = slug.toLowerCase()
      // Skip if we already know any prefixed variant of this slug.
      if (PREFIXES.some(p => knownSlugs.has(`${p}${lower}`))) continue
      if (seenLower.has(lower)) continue
      seenLower.add(lower)
      slugToName.set(slug, name)
    }
  }
  const candidates = Array.from(slugToName.keys()).slice(0, CAP === Infinity ? undefined : CAP)
  console.log(`[discover-icims] names=${names.length} known=${knownSlugs.size} candidates=${candidates.length} (×${PREFIXES.length} URL variants each)`)

  const limiter = pLimit(concurrency)
  let processed = 0; let hits = 0

  type HitRecord = { host: string; slug: string; name: string }
  const newHits: HitRecord[] = []

  await Promise.all(
    candidates.map(companySlug =>
      limiter(async () => {
        processed++
        const hit = await probeIcims(companySlug)
        if (hit) {
          hits++
          const name = slugToName.get(companySlug) ?? companySlug
          newHits.push({ host: hit.host, slug: hit.slug, name })
          console.log(`  ✓ ${hit.slug.padEnd(38)} (${name})`)
        }
        if (processed % 500 === 0) {
          console.log(`  progress: ${processed}/${candidates.length} hits=${hits}`)
        }
      })
    )
  )

  console.log(`\n[discover-icims] probed=${processed} hits=${hits}`)

  if (execute && newHits.length > 0) {
    console.log("  waiting 90s for sockets to drain…")
    await new Promise(r => setTimeout(r, 90_000))
  }

  if (!execute) {
    console.log("\nDry-run — use --execute to write to DB.")
    await pool.end(); return
  }

  if (newHits.length === 0) {
    console.log("Nothing new to insert.")
    await pool.end(); return
  }

  let enrolled = 0; let held = 0; let rejected = 0
  for (const { host, slug, name } of newHits) {
    const { score, factors, decision, rejectedReason } = computeConfidence({
      atsMatch: true, apiHttp200: true, jobsFound: 1,
      usaConfirmed: false, usaJobCount: 0,
      fromCuratedSeed: false, fromCommonCrawl: false,
      isJobDetailPageOnly: false, isDnsFailure: false,
      isLoginRedirect: false, isLikelyTrial: false, isHttpError: false,
      priorRejections: 0,
    })

    const careersUrl = `https://${host}/jobs/search`
    const domain     = host  // e.g. "keysight.icims.com" — already unique

    try {
      if (decision === "enroll") {
        const r = await pool.query(
          `INSERT INTO companies
             (name, domain, careers_url, ats_type, ats_identifier,
              is_active, status, freshness_tier, discovered_via, next_harvest_at)
           VALUES ($1,$2,$3,'icims',$4,true,'active','tier_2','icims-probe',now())
           ON CONFLICT (domain) DO NOTHING
           RETURNING id`,
          [name, domain, careersUrl, slug]
        )
        if (r.rowCount && r.rowCount > 0) enrolled++
      } else {
        const nextRetry = decision === "hold"
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
        await pool.query(
          `INSERT INTO discovered_candidates
             (raw_url, ats_type, ats_identifier, normalized_url, source,
              confidence_score, confidence_factors, rejected_reason, next_retry_at)
           VALUES ($1,'icims',$2,$3,'icims-probe',$4,$5,$6,$7)
           ON CONFLICT (ats_type, ats_identifier) DO NOTHING`,
          [careersUrl, slug, careersUrl, score, JSON.stringify(factors), rejectedReason, nextRetry]
        )
        if (decision === "hold") held++; else rejected++
      }
    } catch (err) {
      console.warn(`insert failed for ${slug}: ${err instanceof Error ? err.message : err}`)
    }
  }

  await pool.query(
    `INSERT INTO discovery_runs (channel, candidates_found, candidates_enrolled, candidates_held, candidates_rejected)
     VALUES ('icims-probe',$1,$2,$3,$4)`,
    [newHits.length, enrolled, held, rejected]
  ).catch(() => {})

  console.log(`[discover-icims] enrolled=${enrolled} held=${held} rejected=${rejected}`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
