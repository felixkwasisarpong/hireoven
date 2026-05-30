/**
 * Discover Workday tenants by probing the Workday job-board API.
 *
 * Workday has ~400 known tenants in the DB (from crt.sh + seed file). This
 * script extends coverage by generating tenant slug candidates from ALL active
 * company names in the DB, then probing each across the 9 known Workday
 * clusters (wd1, wd2, wd3, wd5, wd12, wd103, wd108, wd501, wd503).
 *
 * Probe strategy (two-phase to minimize latency):
 *   1. Quick check — GET /wday/cxs/{tenant}/sites on each cluster. First
 *      cluster that returns HTTP 200 wins. Cheap: one request per cluster.
 *   2. Full resolve — resolveWorkdaySite() to get the named site (redirect /
 *      sites-api / common-site probe). This only runs after a cluster hit.
 *
 * Workday's API is not behind Cloudflare so concurrency up to 12 is safe.
 * The bottleneck is the 9-cluster sweep per candidate (~250ms × 9 = 2s worst).
 *
 * Usage:
 *   npx tsx scripts/discover-workday-tenants.ts               # dry-run
 *   npx tsx scripts/discover-workday-tenants.ts --execute
 *   npx tsx scripts/discover-workday-tenants.ts --execute --concurrency=8
 *   npx tsx scripts/discover-workday-tenants.ts --execute --limit=500
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"

loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { resolveWorkdaySite } from "@/lib/harvester/discovery/workday-resolver"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { computeConfidence } from "@/lib/discovery/confidence-score"
import { WORKDAY_CLUSTERS } from "./data/workday-tenant-seeds"

// Swallow stray undici ERR_INVALID_STATE from AbortController cleanup races.
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

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const execute     = args.includes("--execute")
const concurrency = Math.max(1, Number.parseInt(args.find(a => a.startsWith("--concurrency="))?.split("=")[1] ?? "10", 10))
const capArg      = Number.parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "", 10)
const CAP         = Number.isFinite(capArg) && capArg > 0 ? capArg : Infinity

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error("DATABASE_URL not set — aborting"); process.exit(1) }

const PROBE_TIMEOUT_MS = 5_000

// ─── Slug generation ──────────────────────────────────────────────────────────
// Workday tenant slugs are lowercase alphanumeric, usually the company name or
// domain stem. We generate a small set of variants per company name.

function generateTenantCandidates(name: string, domain?: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const push = (s: string) => {
    const v = s.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (v.length >= 2 && v.length <= 40 && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }

  // Name-derived: strip common suffixes, then condense.
  const cleaned = name
    .replace(/\b(incorporated|inc\.?|l\.?l\.?c\.?|llp|corp\.?|corporation|ltd\.?|limited|co\.?|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas)\b/gi, " ")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .trim()

  push(cleaned.replace(/\s+/g, ""))           // "Parker Hannifin" → "parkerhannifin"
  push(cleaned.split(/\s+/)[0] ?? "")         // first word
  push(cleaned.replace(/\s+/g, "-").replace(/-+/g, "-")) // "parker-hannifin"

  // Domain stem (drop TLD): "nvidia.com" → "nvidia"
  if (domain) {
    const stem = domain.toLowerCase().replace(/\.[a-z]{2,}$/, "").replace(/^www\./, "")
    push(stem)
    push(stem.replace(/-/g, ""))
    push(stem.split("-")[0] ?? "")
  }

  return out
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function loadKnownWorkdayTenants(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT ats_identifier FROM companies WHERE ats_type = 'workday' AND ats_identifier IS NOT NULL`
  )
  // Extract just the tenant slug (first segment of "tenant:wd:site").
  const tenants = new Set<string>()
  for (const r of rows) {
    if (!r.ats_identifier) continue
    const tenant = r.ats_identifier.split(":")[0]?.toLowerCase()
    if (tenant) tenants.add(tenant)
  }
  return tenants
}

async function loadKnownDiscoveredWorkday(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT ats_identifier FROM discovered_candidates WHERE ats_type = 'workday' AND ats_identifier IS NOT NULL`
  )
  const tenants = new Set<string>()
  for (const r of rows) {
    if (!r.ats_identifier) continue
    const tenant = r.ats_identifier.split(":")[0]?.toLowerCase()
    if (tenant) tenants.add(tenant)
  }
  return tenants
}

async function loadCandidateNames(pool: Pool): Promise<Array<{ name: string; domain: string }>> {
  const { rows } = await pool.query<{ name: string; domain: string }>(
    `SELECT name, domain FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND (ats_type IS NULL OR ats_type != 'workday')`
  )
  return rows
}

// ─── Probe ────────────────────────────────────────────────────────────────────

async function findWorkdayCluster(tenant: string): Promise<string | null> {
  for (const wd of WORKDAY_CLUSTERS) {
    const url = `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${encodeURIComponent(tenant)}/sites`
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "user-agent": "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)",
          accept: "application/json",
        },
        signal: ctrl.signal,
      })
      clearTimeout(t)
      if (res.status === 200) return wd
    } catch {
      // timeout or DNS failure — try next cluster
    }
  }
  return null
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  console.log(`[discover-workday] mode=${execute ? "execute" : "dry-run"} concurrency=${concurrency}`)
  console.log(`[discover-workday] clusters: ${WORKDAY_CLUSTERS.join(", ")}`)

  const [companies, knownTenants, knownDiscovered] = await Promise.all([
    loadCandidateNames(pool),
    loadKnownWorkdayTenants(pool),
    loadKnownDiscoveredWorkday(pool),
  ])

  console.log(`[discover-workday] known workday tenants=${knownTenants.size} known candidates=${knownDiscovered.size}`)

  // Build deduped candidate map: tenant slug → company name.
  const tenantToName = new Map<string, string>()
  const seenTenant   = new Set<string>()
  for (const { name, domain } of companies) {
    for (const tenant of generateTenantCandidates(name, domain)) {
      if (knownTenants.has(tenant)) continue
      if (knownDiscovered.has(tenant)) continue
      if (seenTenant.has(tenant)) continue
      seenTenant.add(tenant)
      tenantToName.set(tenant, name)
    }
  }

  const candidates = Array.from(tenantToName.keys()).slice(0, CAP === Infinity ? undefined : CAP)
  console.log(`[discover-workday] candidates to probe: ${candidates.length}`)

  const limiter   = pLimit(concurrency)
  let processed   = 0
  let clusterHits = 0
  let resolved    = 0

  type HitRecord = { tenant: string; wd: string; site: string; name: string; source: string }
  const hits: HitRecord[] = []

  await Promise.all(
    candidates.map(tenant =>
      limiter(async () => {
        processed++

        const wd = await findWorkdayCluster(tenant)
        if (!wd) {
          if (processed % 500 === 0) {
            console.log(`  progress: ${processed}/${candidates.length} cluster_hits=${clusterHits} resolved=${resolved}`)
          }
          return
        }

        clusterHits++
        const result = await resolveWorkdaySite({ tenant, wd, timeoutMs: 10_000 })
        if (!result) {
          if (processed % 500 === 0) {
            console.log(`  progress: ${processed}/${candidates.length} cluster_hits=${clusterHits} resolved=${resolved}`)
          }
          return
        }

        resolved++
        const name = tenantToName.get(tenant) ?? tenant
        hits.push({ tenant, wd, site: result.site, name, source: result.source })
        console.log(`  ✓ ${name.padEnd(36)} ${tenant}:${wd}:${result.site} (${result.source})`)
      })
    )
  )

  console.log(`\n[discover-workday] probed=${processed} cluster_hits=${clusterHits} resolved=${resolved}`)

  if (!execute) {
    console.log("\nDry-run — use --execute to write to DB.")
    await pool.end()
    return
  }

  if (hits.length === 0) {
    console.log("Nothing new to insert.")
    await pool.end()
    return
  }

  let enrolled = 0
  let held     = 0
  let rejected = 0

  for (const h of hits) {
    const slug       = `${h.tenant}:${h.wd}:${h.site}`
    const careersUrl = canonicalCareersUrl("workday", slug)
    if (!careersUrl) continue

    const domain = `${h.tenant}.workday-discovered`

    const { score, factors, decision, rejectedReason } = computeConfidence({
      atsMatch:            true,
      apiHttp200:          true,
      jobsFound:           1,   // cluster hit + site resolve = board exists with content
      usaConfirmed:        false,
      usaJobCount:         0,
      fromCuratedSeed:     false,
      fromCommonCrawl:     false,
      isJobDetailPageOnly: false,
      isDnsFailure:        false,
      isLoginRedirect:     false,
      isLikelyTrial:       false,
      isHttpError:         false,
      priorRejections:     0,
    })

    try {
      if (decision === "enroll") {
        const r = await pool.query(
          `INSERT INTO companies
             (name, domain, careers_url, ats_type, ats_identifier,
              is_active, status, freshness_tier, discovered_via, next_harvest_at)
           VALUES ($1,$2,$3,'workday',$4,true,'active','tier_2','workday-probe',now())
           ON CONFLICT (domain) DO NOTHING
           RETURNING id`,
          [h.name, domain, careersUrl, slug]
        )
        if (r.rowCount && r.rowCount > 0) {
          enrolled++
          knownTenants.add(h.tenant)
        }
      } else {
        const nextRetry = decision === "hold"
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          : null
        await pool.query(
          `INSERT INTO discovered_candidates
             (raw_url, ats_type, ats_identifier, normalized_url, source,
              confidence_score, confidence_factors, rejected_reason, next_retry_at)
           VALUES ($1,'workday',$2,$3,'workday-probe',$4,$5,$6,$7)
           ON CONFLICT (ats_type, ats_identifier) DO NOTHING`,
          [careersUrl, slug, careersUrl, score, JSON.stringify(factors), rejectedReason, nextRetry]
        )
        if (decision === "hold") held++; else rejected++
      }
    } catch (err) {
      console.warn(`[discover-workday] insert failed for ${slug}: ${err instanceof Error ? err.message : err}`)
    }
  }

  await pool.query(
    `INSERT INTO discovery_runs (channel, candidates_found, candidates_enrolled, candidates_held, candidates_rejected)
     VALUES ('workday-probe',$1,$2,$3,$4)`,
    [hits.length, enrolled, held, rejected]
  ).catch(() => { /* non-fatal */ })

  console.log(`\n[discover-workday] enrolled=${enrolled} held=${held} rejected=${rejected}`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
