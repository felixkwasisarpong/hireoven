/**
 * Discover BambooHR tenants by probing the public careers page.
 *
 * BambooHR career pages live at https://{slug}.bamboohr.com/careers.
 * Response behavior (browser-like UA required to avoid Cloudflare):
 *   200  = real tenant with public careers page enabled
 *   302 → www.bamboohr.com → 403  = non-existent OR private careers page
 *
 * Only companies with public careers pages are discoverable via probe.
 * Companies using BambooHR without a public board won't show up — this is
 * intentional: if there are no public jobs we have nothing to harvest.
 *
 * Usage:
 *   npx tsx scripts/discover-bamboohr-tenants.ts               # dry-run
 *   npx tsx scripts/discover-bamboohr-tenants.ts --execute
 *   npx tsx scripts/discover-bamboohr-tenants.ts --execute --wordlist=full
 *   npx tsx scripts/discover-bamboohr-tenants.ts --execute --concurrency=8
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"

loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { computeConfidence } from "@/lib/discovery/confidence-score"
import { humanizeSeedSlug } from "@/lib/discovery/seed-slug"

const args        = process.argv.slice(2)
const execute     = args.includes("--execute")
const wordlist    = (args.find(a => a.startsWith("--wordlist="))?.split("=")[1] ?? "seeds") as "seeds" | "full"
const concurrency = Math.max(1, Number.parseInt(args.find(a => a.startsWith("--concurrency="))?.split("=")[1] ?? "8", 10))
const capArg      = Number.parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "", 10)
const CAP         = Number.isFinite(capArg) && capArg > 0 ? capArg : Infinity

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error("DATABASE_URL not set — aborting"); process.exit(1) }

const PROBE_TIMEOUT_MS = 10_000

// Browser-like UA avoids Cloudflare 403 on www.bamboohr.com redirect target.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

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
  return Array.from(out).filter(s => s.length >= 2 && s.length <= 50)
}

async function probeBambooHR(slug: string): Promise<boolean> {
  const url = `https://${encodeURIComponent(slug)}.bamboohr.com/careers`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": UA, accept: "text/html" },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (res.status === 200) return true
    // 302 to www.bamboohr.com = non-existent or private
    if (res.status === 301 || res.status === 302) {
      const loc = res.headers.get("location") ?? ""
      return !loc.includes("www.bamboohr.com") && !loc.includes("bamboohr.com/")
    }
    return false
  } catch {
    return false
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
      `SELECT name FROM companies WHERE is_active=true AND duplicate_of_company_id IS NULL AND (ats_type IS NULL OR ats_type != 'bamboohr')`
    )
    for (const r of rows) seeds.add(r.name)
  }
  return Array.from(seeds)
}

async function loadKnownSlugs(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT ats_identifier FROM companies WHERE ats_type='bamboohr' AND ats_identifier IS NOT NULL`
  )
  return new Set(rows.map(r => (r.ats_identifier ?? "").toLowerCase()).filter(Boolean))
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  console.log(`[discover-bamboohr] mode=${execute ? "execute" : "dry-run"} wordlist=${wordlist} concurrency=${concurrency}`)

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
  console.log(`[discover-bamboohr] names=${names.length} known=${knownSlugs.size} candidates=${candidates.length}`)

  const limiter = pLimit(concurrency)
  let processed = 0; let hits = 0
  const newHits: Array<{ slug: string; name: string }> = []

  await Promise.all(
    candidates.map(slug =>
      limiter(async () => {
        processed++
        const ok = await probeBambooHR(slug)
        if (ok) {
          hits++
          const name = slugToName.get(slug) ?? slug
          newHits.push({ slug, name })
          console.log(`  ✓ ${slug.padEnd(36)} (${name})`)
        }
        if (processed % 500 === 0) console.log(`  progress: ${processed}/${candidates.length} hits=${hits}`)
      })
    )
  )

  console.log(`\n[discover-bamboohr] probed=${processed} hits=${hits}`)

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
    const careersUrl = `https://${slug}.bamboohr.com/careers`
    const domain     = `${slug.toLowerCase()}.bamboohr.com`
    try {
      if (decision === "enroll") {
        const r = await pool.query(
          `INSERT INTO companies (name,domain,careers_url,ats_type,ats_identifier,is_active,status,freshness_tier,discovered_via,next_harvest_at)
           VALUES ($1,$2,$3,'bamboohr',$4,true,'active','tier_2','bamboohr-probe',now())
           ON CONFLICT (domain) DO NOTHING RETURNING id`,
          [name, domain, careersUrl, slug]
        )
        if (r.rowCount && r.rowCount > 0) enrolled++
      } else {
        const nextRetry = decision === "hold" ? new Date(Date.now() + 7*24*60*60*1000).toISOString() : null
        await pool.query(
          `INSERT INTO discovered_candidates (raw_url,ats_type,ats_identifier,normalized_url,source,confidence_score,confidence_factors,rejected_reason,next_retry_at)
           VALUES ($1,'bamboohr',$2,$3,'bamboohr-probe',$4,$5,$6,$7) ON CONFLICT (ats_type,ats_identifier) DO NOTHING`,
          [careersUrl, slug, careersUrl, score, JSON.stringify(factors), rejectedReason, nextRetry]
        )
        if (decision === "hold") held++; else rejected++
      }
    } catch (err) {
      console.warn(`insert failed for ${slug}: ${err instanceof Error ? err.message : err}`)
    }
  }

  await pool.query(
    `INSERT INTO discovery_runs (channel,candidates_found,candidates_enrolled,candidates_held,candidates_rejected) VALUES ('bamboohr-probe',$1,$2,$3,$4)`,
    [newHits.length, enrolled, held, rejected]
  ).catch(() => {})

  console.log(`[discover-bamboohr] enrolled=${enrolled} held=${held} rejected=${rejected}`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
