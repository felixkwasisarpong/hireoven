/**
 * GET /api/cron/discover-companies
 *
 * Daily company discovery pipeline. Runs all zero-cost and low-cost
 * discovery methods in sequence and reports how many new companies were
 * enrolled. Call this once per day from an external scheduler.
 *
 * Stages (in order):
 *   1. apply_url ATS detection  — classify unclassified companies from their
 *      existing job apply_urls. Zero network cost.
 *   2. GitHub seeds             — scrape curated GitHub ATS README lists
 *      (SimplifyJobs/New-Grad-Positions, etc.)
 *   3. crt.sh discovery         — Certificate Transparency scan for all
 *      supported ATS apex domains. Skipped automatically if crt.sh is down.
 *
 * Env:
 *   CRON_SECRET                 — required auth header value
 *   DISCOVER_SKIP_CRTSH         — set to "true" to skip crt.sh stage
 *   DISCOVER_SKIP_GITHUB        — set to "true" to skip GitHub seeds stage
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { discoverHostsForApex } from "@/lib/harvester/discovery/crtsh"
import { fetchAndExtract, DEFAULT_SEED_SOURCES } from "@/lib/harvester/discovery/github-seeds"
import type { AtsName } from "@/lib/harvester/adapters"
import type { Pool } from "pg"

export const runtime = "nodejs"
export const maxDuration = 300

const AGGREGATOR_DOMAINS = new Set([
  "www.linkedin.com", "linkedin.com", "www.dice.com", "dice.com",
  "www.indeed.com", "indeed.com", "www.glassdoor.com", "glassdoor.com",
  "www.ziprecruiter.com", "ziprecruiter.com", "wellfound.com", "angel.co",
  "account.ycombinator.com",
])

function isAggregator(url: string): boolean {
  try { return AGGREGATOR_DOMAINS.has(new URL(url).hostname.toLowerCase()) } catch { return false }
}

// ─── Stage 1: apply_url ATS detection ────────────────────────────────────────

async function runApplyUrlDetection(pool: Pool): Promise<number> {
  const { rows: companies } = await pool.query<{ id: string; name: string }>(`
    SELECT DISTINCT c.id, c.name
    FROM companies c
    JOIN jobs j ON j.company_id = c.id
    WHERE c.is_active = true
      AND c.ats_type IS NULL
      AND j.is_active = true
      AND j.apply_url IS NOT NULL AND j.apply_url != ''
      AND j.apply_url NOT LIKE '%linkedin%'
      AND j.apply_url NOT LIKE '%dice.com%'
      AND j.apply_url NOT LIKE '%indeed.com%'
      AND j.apply_url NOT LIKE '%glassdoor%'
      AND j.apply_url NOT LIKE '%ziprecruiter%'
  `)

  let updated = 0
  for (const company of companies) {
    const { rows: urlRows } = await pool.query<{ apply_url: string }>(
      `SELECT DISTINCT apply_url FROM jobs
       WHERE company_id = $1 AND is_active = true
         AND apply_url IS NOT NULL AND apply_url != ''
         AND apply_url NOT LIKE '%linkedin%'
       LIMIT 10`,
      [company.id]
    )

    const tally = new Map<string, { ats_type: string; ats_identifier: string; votes: number }>()
    for (const { apply_url } of urlRows) {
      if (isAggregator(apply_url)) continue
      const det = detectAdapter(apply_url)
      if (!det) continue
      const key = `${det.adapter.name}:${det.slug}`
      const e = tally.get(key)
      if (e) e.votes++; else tally.set(key, { ats_type: det.adapter.name, ats_identifier: det.slug, votes: 1 })
    }
    if (tally.size === 0) continue

    const best = [...tally.values()].sort((a, b) => b.votes - a.votes)[0]
    const careers = canonicalCareersUrl(best.ats_type as AtsName, best.ats_identifier)
    if (!careers) continue

    const res = await pool.query(
      `UPDATE companies SET ats_type=$1, ats_identifier=$2,
         careers_url=COALESCE(NULLIF(careers_url,''), $3), next_harvest_at=NULL
       WHERE id=$4 AND ats_type IS NULL`,
      [best.ats_type, best.ats_identifier, careers, company.id]
    )
    if (res.rowCount && res.rowCount > 0) updated++
  }
  return updated
}

// ─── Stage 2: GitHub seeds ────────────────────────────────────────────────────

async function runGithubSeeds(pool: Pool): Promise<number> {
  const allCandidates = new Map<string, { atsType: string; slug: string; careersUrl: string }>()
  for (const source of DEFAULT_SEED_SOURCES) {
    const { candidates, summary } = await fetchAndExtract(source)
    if (!summary.ok) continue
    for (const c of candidates) {
      const key = `${c.atsType}:${c.slug}`
      if (!allCandidates.has(key)) allCandidates.set(key, c)
    }
  }

  const { rows: known } = await pool.query<{ careers_url: string }>(
    `SELECT careers_url FROM companies WHERE careers_url = ANY($1::text[])`,
    [[...allCandidates.values()].map((c) => c.careersUrl)]
  )
  const knownUrls = new Set(known.map((r) => r.careers_url))

  let inserted = 0
  for (const c of allCandidates.values()) {
    if (knownUrls.has(c.careersUrl)) continue
    let domain: string
    try { domain = new URL(c.careersUrl).hostname } catch { domain = c.careersUrl }

    try {
      const res = await pool.query(
        `INSERT INTO companies (name, domain, careers_url, ats_type, ats_identifier,
           status, freshness_tier, discovered_via, is_active)
         VALUES ($1,$2,$3,$4,$5,'active','tier_3',$6,true)
         ON CONFLICT DO NOTHING`,
        [c.slug, domain, c.careersUrl, c.atsType, c.slug, "cron:discover-companies:github"]
      )
      if (res.rowCount && res.rowCount > 0) inserted++
    } catch {
      // Skip individual failures — usually NOT NULL or unique constraint edge cases
    }
  }
  return inserted
}

// ─── Stage 3: crt.sh discovery ───────────────────────────────────────────────

const CRTSH_TARGETS: Array<{ ats: AtsName; apex: string; toUrl: (host: string, slug: string) => string | null }> = [
  { ats: "greenhouse",     apex: "greenhouse.io",      toUrl: (_h, s) => `https://boards.greenhouse.io/${s}` },
  { ats: "ashby",          apex: "ashbyhq.com",        toUrl: (_h, s) => `https://jobs.ashbyhq.com/${s}` },
  { ats: "lever",          apex: "lever.co",           toUrl: (_h, s) => `https://jobs.lever.co/${s}` },
  { ats: "smartrecruiters",apex: "smartrecruiters.com",toUrl: (_h, s) => `https://jobs.smartrecruiters.com/${s}` },
  { ats: "workable",       apex: "workable.com",       toUrl: (_h, s) => `https://apply.workable.com/${s}/` },
  { ats: "recruitee",      apex: "recruitee.com",      toUrl: (h)     => `https://${h}/` },
  { ats: "teamtailor",     apex: "teamtailor.com",     toUrl: (h)     => `https://${h}/` },
  { ats: "bamboohr",       apex: "bamboohr.com",       toUrl: (h)     => `https://${h}/careers` },
  { ats: "jazzhr",         apex: "applytojob.com",     toUrl: (h)     => `https://${h}/` },
  { ats: "personio",       apex: "personio.com",       toUrl: (h)     => {
    const l = h.toLowerCase()
    return (l.endsWith(".jobs.personio.com") || l.endsWith(".jobs.personio.de")) ? `https://${l}/` : null
  }},
  { ats: "icims",          apex: "icims.com",          toUrl: (h)     => {
    if (/^(cdn|www|api|developer|images|community|partners|trust|legal)\.icims\.com$/.test(h)) return null
    return `https://${h}/`
  }},
]

async function runCrtshDiscovery(pool: Pool): Promise<number> {
  let inserted = 0
  for (const target of CRTSH_TARGETS) {
    let hosts
    try {
      hosts = await discoverHostsForApex(target.apex, { timeoutMs: 60_000, maxAttempts: 2 })
    } catch {
      continue // crt.sh down or timed out — skip this apex
    }

    const urls = hosts.map((h) => target.toUrl(h.host, h.slug)).filter((u): u is string => Boolean(u))
    const detected = urls.map((u) => ({ url: u, det: detectAdapter(u) }))
      .filter((x): x is { url: string; det: NonNullable<ReturnType<typeof detectAdapter>> } =>
        Boolean(x.det && x.det.adapter.name === target.ats)
      )

    if (detected.length === 0) continue

    const { rows: known } = await pool.query<{ careers_url: string }>(
      `SELECT careers_url FROM companies WHERE careers_url = ANY($1::text[])`,
      [detected.map((x) => x.url)]
    )
    const knownUrls = new Set(known.map((r) => r.careers_url))

    for (const { url, det } of detected) {
      if (knownUrls.has(url)) continue
      let domain: string
      try { domain = new URL(url).hostname } catch { domain = url }
      try {
        const res = await pool.query(
          `INSERT INTO companies (name, domain, careers_url, ats_type, ats_identifier,
             status, freshness_tier, discovered_via, is_active)
           VALUES ($1,$2,$3,$4,$5,'active','tier_3',$6,true)
           ON CONFLICT DO NOTHING`,
          [det.slug, domain, url, target.ats, det.slug, `cron:discover-companies:crtsh:${target.ats}`]
        )
        if (res.rowCount && res.rowCount > 0) inserted++
      } catch { /* skip */ }
    }
  }
  return inserted
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authed = requireCronAuth(req.headers.get("authorization"))
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const skipCrtsh = process.env.DISCOVER_SKIP_CRTSH === "true"
  const skipGithub = process.env.DISCOVER_SKIP_GITHUB === "true"

  const pool = getPostgresPool()
  const result: Record<string, number> = {}

  result.apply_url = await runApplyUrlDetection(pool)
  result.github_seeds = skipGithub ? 0 : await runGithubSeeds(pool)
  result.crtsh = skipCrtsh ? 0 : await runCrtshDiscovery(pool)
  result.total = Object.values(result).reduce((a, b) => a + b, 0) - (result.total ?? 0)

  return NextResponse.json({ ok: true, enrolled: result })
}
