/**
 * Mine the Common Crawl CDX index for ATS career-board URLs.
 *
 * For each configured ATS apex domain, queries the free CDX API for every
 * URL matching that domain that CC indexed with HTTP 200. Normalises each URL
 * to its canonical board root, dedupes against the DB, scores with the
 * confidence gate, and either enrolls directly or holds in discovered_candidates.
 *
 * This is the highest-leverage, zero-cost discovery source — a single run can
 * surface tens of thousands of new tenants across all ATSes.
 *
 * Usage:
 *   npx tsx scripts/mine-commoncrawl-ats.ts                     # dry-run all
 *   npx tsx scripts/mine-commoncrawl-ats.ts --execute
 *   npx tsx scripts/mine-commoncrawl-ats.ts --execute --ats=lever,greenhouse
 *   npx tsx scripts/mine-commoncrawl-ats.ts --execute --ats=workday --limit=50000
 *   npx tsx scripts/mine-commoncrawl-ats.ts --execute --index=CC-MAIN-2025-05
 *
 * Env:
 *   DATABASE_URL   — required
 *   CC_INDEX       — optional override for the CC crawl index name
 */

import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import type { AtsName } from "@/lib/harvester/adapters"
import { queryCdxForApex, normalizeCdxUrlToBoard, DEFAULT_CC_INDEX } from "@/lib/discovery/commoncrawl-cdx"
import { computeConfidence } from "@/lib/discovery/confidence-score"
import { humanizeSeedSlug } from "@/app/api/cron/discover-companies/route"

// ─── ATS target list ──────────────────────────────────────────────────────────

type CdxTarget = {
  ats: AtsName
  /** The apex domain to pass to the CDX wildcard query (*.apex). */
  apex: string
}

// Only include ATSes where CC crawls shared-domain job boards accessible via
// path prefix (e.g. jobs.lever.co/{slug}/*). Subdomain-per-tenant ATSes
// (BambooHR, Recruitee, TeamTailor, Workday, iCIMS) are not indexed by CC
// at the tenant-subdomain level — use crt.sh for those instead.
const CDX_TARGETS: CdxTarget[] = [
  { ats: "greenhouse",      apex: "boards.greenhouse.io"     },
  { ats: "greenhouse",      apex: "job-boards.greenhouse.io" },
  { ats: "lever",           apex: "jobs.lever.co"            },
  { ats: "ashby",           apex: "jobs.ashbyhq.com"         },
  { ats: "smartrecruiters", apex: "jobs.smartrecruiters.com" },
  { ats: "workable",        apex: "apply.workable.com"       },
  { ats: "rippling",        apex: "ats.rippling.com"         },
]

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const execute    = args.includes("--execute")
const indexArg   = args.find(a => a.startsWith("--index="))?.split("=")[1]
const ccIndex    = indexArg ?? DEFAULT_CC_INDEX
const limitArg   = Number.parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "200000", 10)
const cdxLimit   = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 200_000
const atsFilter  = args.find(a => a.startsWith("--ats="))?.split("=")[1]?.split(",").map(s => s.trim()) ?? []

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set — aborting")
  process.exit(1)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function loadKnownAtsKeys(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_type: string | null; ats_identifier: string | null }>(
    `SELECT ats_type, lower(ats_identifier) AS ats_identifier
       FROM companies
      WHERE ats_type IS NOT NULL AND ats_identifier IS NOT NULL`
  )
  return new Set(rows.map(r => `${r.ats_type}:${r.ats_identifier}`))
}

async function loadKnownDiscoveredKeys(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_type: string | null; ats_identifier: string | null }>(
    `SELECT ats_type, lower(ats_identifier) AS ats_identifier
       FROM discovered_candidates
      WHERE ats_type IS NOT NULL AND ats_identifier IS NOT NULL`
  )
  return new Set(rows.map(r => `${r.ats_type}:${r.ats_identifier}`))
}

type UpsertResult = "enrolled" | "held" | "rejected" | "skipped"

async function upsertCandidate(
  pool: Pool,
  candidate: {
    atsType: string
    slug: string
    careersUrl: string
    source: string
    score: number
    factors: Record<string, number>
    decision: "enroll" | "hold" | "reject"
    rejectedReason: string | null
  },
  dryRun: boolean
): Promise<UpsertResult> {
  const { atsType, slug, careersUrl, source, score, factors, decision, rejectedReason } = candidate
  const name   = humanizeSeedSlug(atsType, slug)
  // Use a unique placeholder domain per (atsType, slug) so path-based ATSes
  // (Greenhouse, Lever, Ashby, etc.) don't all collide on the shared hostname.
  const domain = `${slug.toLowerCase()}.${atsType}.discovered`

  if (dryRun) return decision === "enroll" ? "enrolled" : decision === "hold" ? "held" : "rejected"

  if (decision === "enroll") {
    const r = await pool.query(
      `INSERT INTO companies
         (name, domain, careers_url, ats_type, ats_identifier,
          is_active, status, freshness_tier, discovered_via, next_harvest_at)
       VALUES ($1,$2,$3,$4,$5,true,'active','tier_3',$6,now())
       ON CONFLICT (domain) DO NOTHING
       RETURNING id`,
      [name, domain, careersUrl, atsType, slug, `commoncrawl:${source}`]
    )
    if (r.rowCount && r.rowCount > 0) return "enrolled"
    return "skipped"
  }

  // Hold or reject — write to discovered_candidates.
  const nextRetry = decision === "hold"
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null

  await pool.query(
    `INSERT INTO discovered_candidates
       (raw_url, ats_type, ats_identifier, normalized_url, source,
        confidence_score, confidence_factors, rejected_reason, next_retry_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (ats_type, ats_identifier) DO NOTHING`,
    [careersUrl, atsType, slug, careersUrl, source,
     score, JSON.stringify(factors), rejectedReason, nextRetry]
  )
  return decision === "hold" ? "held" : "rejected"
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  const activeTargets = atsFilter.length > 0
    ? CDX_TARGETS.filter(t => atsFilter.includes(t.ats))
    : CDX_TARGETS

  if (activeTargets.length === 0) {
    console.error(`No matching targets for --ats=${atsFilter.join(",")}. Available: ${CDX_TARGETS.map(t => t.ats).join(",")}`)
    await pool.end()
    process.exit(1)
  }

  console.log(`[commoncrawl] index=${ccIndex} limit=${cdxLimit} mode=${execute ? "execute" : "dry-run"}`)
  console.log(`[commoncrawl] targets: ${activeTargets.map(t => t.apex).join(", ")}`)

  const knownCompanyKeys   = await loadKnownAtsKeys(pool)
  const knownCandidateKeys = await loadKnownDiscoveredKeys(pool)
  console.log(`[commoncrawl] known companies=${knownCompanyKeys.size} known candidates=${knownCandidateKeys.size}`)

  const totals = { found: 0, new: 0, enrolled: 0, held: 0, rejected: 0, skipped: 0 }

  for (const target of activeTargets) {
    console.log(`\n[commoncrawl] querying CDX for *.${target.apex} …`)
    let entries
    try {
      entries = await queryCdxForApex(target.apex, { index: ccIndex, limit: cdxLimit })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`  ⚠ CDX query failed for ${target.apex}: ${msg}`)
      // Brief pause before next apex to avoid hammering CDX on partial failure.
      await sleep(3_000)
      continue
    }

    console.log(`  CDX returned ${entries.length} URLs for ${target.apex}`)
    totals.found += entries.length

    // Normalise URLs → (atsType, slug, careersUrl) triples.
    // Also track how many CDX entries mapped to each board root — if CC indexed
    // job-detail URLs (paths like /jobs/12345 or /uuid), that's direct evidence
    // the board had active listings at crawl time. Use this count as `jobsFound`
    // so the confidence gate can promote boards with evidence of real jobs.
    const batchSeen = new Set<string>()
    const candidates: Array<{ atsType: string; slug: string; careersUrl: string }> = []
    const hitCountByKey = new Map<string, number>()

    for (const entry of entries) {
      const norm = normalizeCdxUrlToBoard(entry.url, detectAdapter)
      if (!norm) continue
      if (norm.atsType !== target.ats) continue

      const canonical = canonicalCareersUrl(norm.atsType as AtsName, norm.slug)
      if (!canonical) continue

      const key = `${norm.atsType}:${norm.slug.toLowerCase()}`
      // Count every CDX URL for this board (including duplicate paths) as signal.
      hitCountByKey.set(key, (hitCountByKey.get(key) ?? 0) + 1)
      if (batchSeen.has(key)) continue
      batchSeen.add(key)
      candidates.push({ atsType: norm.atsType, slug: norm.slug, careersUrl: canonical })
    }

    const newCandidates = candidates.filter(c => {
      const key = `${c.atsType}:${c.slug.toLowerCase()}`
      return !knownCompanyKeys.has(key) && !knownCandidateKeys.has(key)
    })
    totals.new += newCandidates.length

    console.log(`  ${candidates.length} unique board roots → ${newCandidates.length} new (not in DB)`)
    if (newCandidates.length === 0) continue

    // Score using CDX hit count as jobsFound proxy. CDX doesn't re-probe live;
    // USA check happens on the first harvester tick.
    for (const c of newCandidates) {
      const key = `${c.atsType}:${c.slug.toLowerCase()}`
      // If CC indexed >1 URL for this board, treat it as having real content.
      const cdxHits = hitCountByKey.get(key) ?? 1
      const { score, factors, decision, rejectedReason } = computeConfidence({
        atsMatch:          true,
        apiHttp200:        true,
        jobsFound:         cdxHits,  // multiple CDX hits = strong evidence of active jobs
        usaConfirmed:      false,    // checked at first harvest tick
        usaJobCount:       0,
        fromCuratedSeed:   false,
        fromCommonCrawl:   true,
        isJobDetailPageOnly: false,
        isDnsFailure:      false,
        isLoginRedirect:   false,
        isLikelyTrial:     false,
        isHttpError:       false,
        priorRejections:   0,
      })

      const result = await upsertCandidate(
        pool,
        { ...c, source: target.apex, score, factors, decision, rejectedReason },
        !execute
      )

      // Track in local sets to avoid double-inserts within the same run.
      if (result === "enrolled") { knownCompanyKeys.add(key); totals.enrolled++ }
      else if (result === "held")     { knownCandidateKeys.add(key); totals.held++ }
      else if (result === "rejected") { knownCandidateKeys.add(key); totals.rejected++ }
      else                            totals.skipped++
    }

    console.log(`  apex=${target.apex} → enrolled=${totals.enrolled} held=${totals.held} rejected=${totals.rejected}`)

    // Small pause between CDX queries so we don't DoS the CC servers.
    await sleep(2_000)
  }

  console.log(`\n[commoncrawl] DONE`)
  console.log(`  total CDX rows: ${totals.found}`)
  console.log(`  new (not in DB): ${totals.new}`)
  console.log(`  enrolled: ${totals.enrolled}`)
  console.log(`  held for retry: ${totals.held}`)
  console.log(`  rejected: ${totals.rejected}`)
  console.log(`  skipped (conflict): ${totals.skipped}`)
  if (!execute) console.log("\nDry-run — use --execute to write to DB.")

  if (execute) {
    await pool.query(
      `INSERT INTO discovery_runs (channel, candidates_found, candidates_enrolled, candidates_held, candidates_rejected)
       VALUES ($1,$2,$3,$4,$5)`,
      ["commoncrawl", totals.new, totals.enrolled, totals.held, totals.rejected]
    ).catch(() => { /* non-fatal */ })
  }

  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
