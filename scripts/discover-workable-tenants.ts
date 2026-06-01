/**
 * Discover Workable tenants by probing the public Workable job board.
 *
 * Workable hosts all job boards at apply.workable.com/{slug}.
 * API behavior (no auth required):
 *   apply.workable.com/{slug}/  →  200  = real tenant
 *   apply.workable.com/{slug}/  →  302 → /oops  = non-existent
 *
 * This is a clean, reliable signal with no WAF issues observed.
 * Concurrency 12 is safe; no artificial stagger needed.
 *
 * Usage:
 *   npx tsx scripts/discover-workable-tenants.ts               # dry-run
 *   npx tsx scripts/discover-workable-tenants.ts --execute
 *   npx tsx scripts/discover-workable-tenants.ts --execute --wordlist=full
 *   npx tsx scripts/discover-workable-tenants.ts --execute --concurrency=16
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"

loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { computeConfidence } from "@/lib/discovery/confidence-score"

const args        = process.argv.slice(2)
const execute     = args.includes("--execute")
const wordlist    = (args.find(a => a.startsWith("--wordlist="))?.split("=")[1] ?? "seeds") as "seeds" | "full"
const concurrency = Math.max(1, Number.parseInt(args.find(a => a.startsWith("--concurrency="))?.split("=")[1] ?? "12", 10))
const capArg      = Number.parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "", 10)
const CAP         = Number.isFinite(capArg) && capArg > 0 ? capArg : Infinity

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error("DATABASE_URL not set — aborting"); process.exit(1) }

const PROBE_TIMEOUT_MS = 10_000

function slugify(s: string) { return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "") }
function slugifyHyphen(s: string) { return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") }

function generateCandidates(name: string): string[] {
  const out = new Set<string>()
  const cleaned = name.replace(/\b(incorporated|inc\.?|l\.?l\.?c\.?|llp|corp\.?|corporation|ltd\.?|limited|co\.?|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas)\b/gi, " ").replace(/[,()&]/g, " ").trim()
  out.add(slugify(cleaned))
  out.add(slugifyHyphen(cleaned))
  const first = cleaned.split(/\s+/)[0]
  if (first) out.add(slugify(first))
  out.add(slugify(name))
  return Array.from(out).filter(s => s.length >= 2 && s.length <= 60)
}

async function probeWorkable(slug: string): Promise<"hit" | "miss" | "blocked"> {
  const url = `https://apply.workable.com/${encodeURIComponent(slug)}/`
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
    // Real tenant: 200. Non-existent: 302 → /oops. Throttled: 403/406/429.
    if (res.status === 200) return "hit"
    if (res.status === 302 || res.status === 301) {
      const loc = res.headers.get("location") ?? ""
      return !loc.includes("/oops") && !loc.includes("workable.com/oops") ? "hit" : "miss"
    }
    if (res.status === 403 || res.status === 406 || res.status === 429) return "blocked"
    return "miss"
  } catch {
    return "miss"
  }
}

async function loadCandidateNames(pool: Pool): Promise<string[]> {
  const seeds = new Set<string>()
  const seedModules = ["./data/company-seeds-expansion","./data/company-seeds-f2000-us","./data/company-seeds","./data/enterprise-ats-seeds","./data/tech-brand-seeds","./data/workday-tenant-seeds"]
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
      `SELECT name FROM companies WHERE is_active=true AND duplicate_of_company_id IS NULL AND (ats_type IS NULL OR ats_type != 'workable')`
    )
    for (const r of rows) seeds.add(r.name)
  }
  return Array.from(seeds)
}

async function loadKnownSlugs(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT ats_identifier FROM companies WHERE ats_type='workable' AND ats_identifier IS NOT NULL`
  )
  return new Set(rows.map(r => (r.ats_identifier ?? "").toLowerCase()).filter(Boolean))
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  console.log(`[discover-workable] mode=${execute ? "execute" : "dry-run"} wordlist=${wordlist} concurrency=${concurrency}`)

  const names      = await loadCandidateNames(pool)
  const knownSlugs = await loadKnownSlugs(pool)

  const slugToName = new Map<string, string>()
  const seenLower  = new Set<string>()
  for (const name of names) {
    for (const slug of generateCandidates(name)) {
      const lower = slug.toLowerCase()
      if (knownSlugs.has(lower) || seenLower.has(lower)) continue
      seenLower.add(lower)
      slugToName.set(slug, name)
    }
  }
  const candidates = Array.from(slugToName.keys()).slice(0, CAP === Infinity ? undefined : CAP)
  console.log(`[discover-workable] names=${names.length} known=${knownSlugs.size} candidates=${candidates.length}`)

  const limiter = pLimit(concurrency)
  let processed = 0
  let hits = 0

  type HitRecord = { slug: string; name: string }
  const newHits: HitRecord[] = []

  // Early WAF circuit-breaker — apply.workable.com 429s under sustained load, so
  // abort mid-run if a rolling window shows too many 403/406/429s.
  const WAF_WINDOW = 100
  const WAF_THRESHOLD = 0.3
  let aborted = false
  let blocked = 0
  const recentBlocked: boolean[] = []

  await Promise.all(
    candidates.map(slug =>
      limiter(async () => {
        if (aborted) return
        processed++
        const result = await probeWorkable(slug)
        const isBlocked = result === "blocked"
        recentBlocked.push(isBlocked)
        if (recentBlocked.length > WAF_WINDOW) recentBlocked.shift()
        if (isBlocked) blocked++
        if (!aborted && recentBlocked.length === WAF_WINDOW &&
            recentBlocked.filter(Boolean).length / WAF_WINDOW > WAF_THRESHOLD) {
          aborted = true
          console.warn(`\n[discover-workable] ⚠ WAF throttling detected — aborting early. Run from a different egress or wait.`)
          return
        }
        if (result === "hit") {
          hits++
          const name = slugToName.get(slug) ?? slug
          newHits.push({ slug, name })
          console.log(`  ✓ ${slug.padEnd(36)} (${name})`)
        }
        if (processed % 1000 === 0) console.log(`  progress: ${processed}/${candidates.length} hits=${hits} blocked=${blocked}`)
      })
    )
  )

  console.log(`\n[discover-workable] probed=${processed} hits=${hits} blocked=${blocked}${aborted ? " (ABORTED — WAF)" : ""}`)

  // Allow TIME_WAIT sockets from the probe phase to drain before opening DB connections.
  if (execute && newHits.length > 0) {
    console.log("  waiting 90s for sockets to drain…")
    await new Promise(r => setTimeout(r, 90_000))
  }

  if (!execute) {
    console.log("\nDry-run — use --execute to write to DB.")
    await pool.end(); return
  }

  let enrolled = 0; let held = 0; let rejected = 0
  for (const { slug, name } of newHits) {
    const { score, factors, decision, rejectedReason } = computeConfidence({
      atsMatch: true, apiHttp200: true, jobsFound: 1,
      usaConfirmed: false, usaJobCount: 0,
      fromCuratedSeed: slugToName.has(slug), fromCommonCrawl: false,
      isJobDetailPageOnly: false, isDnsFailure: false,
      isLoginRedirect: false, isLikelyTrial: false, isHttpError: false,
      priorRejections: 0,
    })
    const careersUrl = `https://apply.workable.com/${slug}/`
    const domain     = `${slug.toLowerCase()}.workable-discovered`
    try {
      if (decision === "enroll") {
        const r = await pool.query(
          `INSERT INTO companies (name,domain,careers_url,ats_type,ats_identifier,is_active,status,freshness_tier,discovered_via,next_harvest_at)
           VALUES ($1,$2,$3,'workable',$4,true,'active','tier_2','workable-probe',now())
           ON CONFLICT (domain) DO NOTHING RETURNING id`,
          [name, domain, careersUrl, slug]
        )
        if (r.rowCount && r.rowCount > 0) enrolled++
      } else {
        const nextRetry = decision === "hold" ? new Date(Date.now() + 7*24*60*60*1000).toISOString() : null
        await pool.query(
          `INSERT INTO discovered_candidates (raw_url,ats_type,ats_identifier,normalized_url,source,confidence_score,confidence_factors,rejected_reason,next_retry_at)
           VALUES ($1,'workable',$2,$3,'workable-probe',$4,$5,$6,$7) ON CONFLICT (ats_type,ats_identifier) DO NOTHING`,
          [careersUrl, slug, careersUrl, score, JSON.stringify(factors), rejectedReason, nextRetry]
        )
        if (decision === "hold") held++; else rejected++
      }
    } catch (err) {
      console.warn(`insert failed for ${slug}: ${err instanceof Error ? err.message : err}`)
    }
  }

  await pool.query(
    `INSERT INTO discovery_runs (channel,candidates_found,candidates_enrolled,candidates_held,candidates_rejected) VALUES ('workable-probe',$1,$2,$3,$4)`,
    [newHits.length, enrolled, held, rejected]
  ).catch(() => {})

  console.log(`[discover-workable] enrolled=${enrolled} held=${held} rejected=${rejected}`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
