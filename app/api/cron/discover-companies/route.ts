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
 *   4. Workday crt.sh discovery — separate stage: resolves tenant+shard pairs
 *      from myworkdayjobs.com certs into full careers URLs via resolveWorkdaySite().
 *      Limited to WORKDAY_CRTSH_RESOLVE_LIMIT tenants per run to fit in 300s budget.
 *   5. Oracle Cloud crt.sh      — stages fa.us*.oraclecloud.com tenants into
 *      discovered_candidates; site resolution handled by a dedicated script.
 *
 * Env:
 *   CRON_SECRET                     — required auth header value
 *   DISCOVER_SKIP_CRTSH             — set to "true" to skip crt.sh stages
 *   DISCOVER_SKIP_GITHUB            — set to "true" to skip GitHub seeds stage
 *   WORKDAY_CRTSH_RESOLVE_LIMIT     — max Workday tenants to resolve per run (default 20)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { discoverHostsForApex } from "@/lib/harvester/discovery/crtsh"
import { resolveWorkdaySite } from "@/lib/harvester/discovery/workday-resolver"
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

// Generic Workday site segments that aren't a real company name on their own
// (e.g. /External, /Careers). When the site is generic we fall back to the
// tenant. When the site is descriptive we strip those words off it instead.
const WORKDAY_GENERIC_SITE_WORD =
  /(external_site|external|careers?|jobs?|search|global|portal|public|main|ext|site)/gi

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
}

/**
 * Best-effort human name from an `(atsType, slug)` discovered via GitHub
 * READMEs or crt.sh — the harvest later overrides `name` from real job
 * `raw_data.company`, this is just to avoid storing literals like
 * "ag:wd3:Airbus" in the meantime.
 *
 * Workday slugs are `tenant:wd:site`; everything else is a single segment.
 */
export function humanizeSeedSlug(atsType: string, slug: string): string {
  if (atsType === "workday") {
    const parts = slug.split(":")
    const tenant = (parts[0] ?? "").trim()
    const site = (parts[2] ?? "").trim()

    const fromSite = titleCase(
      site.replace(WORKDAY_GENERIC_SITE_WORD, " ").replace(/[_\-]+/g, " ").trim()
    )
    if (fromSite.length >= 2) return fromSite
    return titleCase(tenant.replace(/[_\-]+/g, " ")) || slug
  }
  return titleCase(slug.replace(/[_\-]+/g, " ")) || slug
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

  const candidateList = [...allCandidates.values()]
  const careersUrls = candidateList.map((c) => c.careersUrl)
  const atsTypes = [...new Set(candidateList.map((c) => c.atsType))]
  const slugsLower = [...new Set(candidateList.map((c) => c.slug.toLowerCase()))]

  // Dedup against (1) the exact careers_url AND (2) any existing row that
  // already covers (ats_type, lower(ats_identifier)) — case-insensitive — so
  // we don't insert a /External vs /external twin of an existing canonical.
  const { rows: known } = await pool.query<{ careers_url: string | null; ats_type: string | null; ats_id: string | null }>(
    `SELECT careers_url, ats_type, lower(ats_identifier) AS ats_id
       FROM companies
      WHERE careers_url = ANY($1::text[])
         OR (ats_type = ANY($2::text[]) AND lower(ats_identifier) = ANY($3::text[]))`,
    [careersUrls, atsTypes, slugsLower]
  )
  const knownUrls = new Set(known.map((r) => r.careers_url).filter((u): u is string => Boolean(u)))
  const knownAtsKeys = new Set(
    known.filter((r) => r.ats_type && r.ats_id).map((r) => `${r.ats_type}:${r.ats_id}`)
  )

  let inserted = 0
  for (const c of candidateList) {
    if (knownUrls.has(c.careersUrl)) continue
    if (knownAtsKeys.has(`${c.atsType}:${c.slug.toLowerCase()}`)) continue
    let domain: string
    try { domain = new URL(c.careersUrl).hostname } catch { domain = c.careersUrl }

    try {
      const res = await pool.query(
        `INSERT INTO companies (name, domain, careers_url, ats_type, ats_identifier,
           status, freshness_tier, discovered_via, is_active)
         VALUES ($1,$2,$3,$4,$5,'active','tier_3',$6,true)
         ON CONFLICT DO NOTHING`,
        [humanizeSeedSlug(c.atsType, c.slug), domain, c.careersUrl, c.atsType, c.slug, "cron:discover-companies:github"]
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

    const slugsLower = [...new Set(detected.map((x) => x.det.slug.toLowerCase()))]
    const { rows: known } = await pool.query<{ careers_url: string | null; ats_id: string | null }>(
      `SELECT careers_url, lower(ats_identifier) AS ats_id
         FROM companies
        WHERE careers_url = ANY($1::text[])
           OR (ats_type = $2 AND lower(ats_identifier) = ANY($3::text[]))`,
      [detected.map((x) => x.url), target.ats, slugsLower]
    )
    const knownUrls = new Set(known.map((r) => r.careers_url).filter((u): u is string => Boolean(u)))
    const knownAtsIds = new Set(known.map((r) => r.ats_id).filter((id): id is string => Boolean(id)))

    for (const { url, det } of detected) {
      if (knownUrls.has(url)) continue
      if (knownAtsIds.has(det.slug.toLowerCase())) continue
      let domain: string
      try { domain = new URL(url).hostname } catch { domain = url }
      try {
        const res = await pool.query(
          `INSERT INTO companies (name, domain, careers_url, ats_type, ats_identifier,
             status, freshness_tier, discovered_via, is_active)
           VALUES ($1,$2,$3,$4,$5,'active','tier_3',$6,true)
           ON CONFLICT DO NOTHING`,
          [humanizeSeedSlug(target.ats, det.slug), domain, url, target.ats, det.slug, `cron:discover-companies:crtsh:${target.ats}`]
        )
        if (res.rowCount && res.rowCount > 0) inserted++
      } catch { /* skip */ }
    }
  }
  return inserted
}

// ─── Stage 4: Workday crt.sh + site resolution ───────────────────────────────

// How many Workday tenants to call resolveWorkdaySite() on per cron run.
// Each call can take up to ~10s; at 20 tenants that is ~200s, leaving room for
// the other stages within the 300s Vercel budget.
const WORKDAY_CRTSH_RESOLVE_LIMIT = Number.parseInt(
  process.env.WORKDAY_CRTSH_RESOLVE_LIMIT ?? "20", 10
)

// Regex matching valid Workday WD-shard labels (wd1, wd5, wd10, wd401, etc.).
const WD_SHARD_RE = /^wd\d{1,3}$/

async function runWorkdayCrtshDiscovery(pool: Pool): Promise<number> {
  let hosts
  try {
    hosts = await discoverHostsForApex("myworkdayjobs.com", { timeoutMs: 60_000, maxAttempts: 2 })
  } catch {
    return 0
  }

  // Extract (tenant, wd) pairs from hostnames like "nvidia.wd5.myworkdayjobs.com".
  type WdPair = { tenant: string; wd: string }
  const pairs: WdPair[] = []
  for (const h of hosts) {
    // h.host = "nvidia.wd5.myworkdayjobs.com", h.slug = "nvidia"
    const labels = h.host.replace(/\.myworkdayjobs\.com$/, "").split(".")
    if (labels.length < 2) continue
    const tenant = labels[0]
    const wd     = labels[1]
    if (!tenant || !wd || !WD_SHARD_RE.test(wd)) continue
    pairs.push({ tenant, wd })
  }
  if (pairs.length === 0) return 0

  // Dedup against existing companies.
  const { rows: known } = await pool.query<{ ats_identifier: string }>(
    `SELECT lower(ats_identifier) AS ats_identifier FROM companies
      WHERE ats_type = 'workday' AND ats_identifier IS NOT NULL`
  )
  const knownPrefixes = new Set(
    known.map(r => r.ats_identifier.split(":")[0]).filter(Boolean)
  )

  // Also dedup against discovered_candidates.
  const { rows: staged } = await pool.query<{ ats_identifier: string }>(
    `SELECT lower(ats_identifier) AS ats_identifier FROM discovered_candidates
      WHERE ats_type = 'workday' AND ats_identifier IS NOT NULL`
  )
  const stagedPrefixes = new Set(
    staged.map(r => r.ats_identifier.split(":")[0]).filter(Boolean)
  )

  const newPairs = pairs.filter(p => !knownPrefixes.has(p.tenant.toLowerCase()) && !stagedPrefixes.has(p.tenant.toLowerCase()))
  if (newPairs.length === 0) return 0

  const toResolve = newPairs.slice(0, WORKDAY_CRTSH_RESOLVE_LIMIT)
  let enrolled = 0

  for (const { tenant, wd } of toResolve) {
    let resolved
    try {
      resolved = await resolveWorkdaySite({ tenant, wd, timeoutMs: 8_000 })
    } catch {
      resolved = null
    }

    if (!resolved) {
      // Stage with partial identifier for the dedicated resolution script.
      await pool.query(
        `INSERT INTO discovered_candidates
           (raw_url, ats_type, ats_identifier, source, confidence_score, next_retry_at)
         VALUES ($1,'workday',$2,'crtsh:workday',40,$3)
         ON CONFLICT (ats_type, ats_identifier) DO NOTHING`,
        [
          `https://${tenant}.${wd}.myworkdayjobs.com/`,
          `${tenant.toLowerCase()}:${wd}:unresolved`,
          new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        ]
      ).catch(() => { /* non-fatal */ })
      continue
    }

    const slug       = `${tenant.toLowerCase()}:${wd}:${resolved.site}`
    const careersUrl = canonicalCareersUrl("workday", slug)
    if (!careersUrl) continue

    const name   = humanizeSeedSlug("workday", slug)
    const domain = `${tenant.toLowerCase()}.${wd}.myworkdayjobs.com`

    try {
      const r = await pool.query(
        `INSERT INTO companies
           (name, domain, careers_url, ats_type, ats_identifier,
            status, freshness_tier, discovered_via, is_active)
         VALUES ($1,$2,$3,'workday',$4,'active','tier_3','cron:discover-companies:crtsh:workday',true)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [name, domain, careersUrl, slug]
      )
      if (r.rowCount && r.rowCount > 0) enrolled++
    } catch { /* skip */ }
  }

  // Pairs beyond the resolve limit — stage for the dedicated script.
  for (const { tenant, wd } of newPairs.slice(WORKDAY_CRTSH_RESOLVE_LIMIT)) {
    await pool.query(
      `INSERT INTO discovered_candidates
         (raw_url, ats_type, ats_identifier, source, confidence_score, next_retry_at)
       VALUES ($1,'workday',$2,'crtsh:workday',40,$3)
       ON CONFLICT (ats_type, ats_identifier) DO NOTHING`,
      [
        `https://${tenant}.${wd}.myworkdayjobs.com/`,
        `${tenant.toLowerCase()}:${wd}:unresolved`,
        new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
      ]
    ).catch(() => { /* non-fatal */ })
  }

  return enrolled
}

// ─── Stage 5: Oracle Cloud crt.sh → discovered_candidates ────────────────────

// Oracle Recruiting Cloud tenants appear as {corp}.fa.{pod}.oraclecloud.com.
// We can't determine the site name (needed for the canonical URL) from the
// hostname alone, so we stage them in discovered_candidates. A dedicated script
// (discover-oracle-tenants.ts) probes each for the site name and promotes.
const ORACLE_PODS = ["fa.us2", "fa.us6", "fa.us1", "fa.eu1", "fa.ap2"]

async function runOracleCrtshDiscovery(pool: Pool): Promise<number> {
  const seen = new Set<string>()
  let staged = 0

  // Load known Oracle tenants (pod prefix) to avoid re-staging.
  const { rows: knownRows } = await pool.query<{ ats_identifier: string }>(
    `SELECT lower(ats_identifier) AS ats_identifier FROM companies
      WHERE ats_type = 'oraclecloud' AND ats_identifier IS NOT NULL
     UNION ALL
     SELECT lower(ats_identifier) AS ats_identifier FROM discovered_candidates
      WHERE ats_type = 'oraclecloud' AND ats_identifier IS NOT NULL`
  )
  // Oracle slug starts with "{corp}.fa.{pod}" — use the first segment as dedup key.
  const knownCorps = new Set(knownRows.map(r => r.ats_identifier.split(":")[0]?.split(".")[0]).filter(Boolean))

  for (const pod of ORACLE_PODS) {
    const apex = `${pod}.oraclecloud.com`
    let hosts
    try {
      hosts = await discoverHostsForApex(apex, { timeoutMs: 30_000, maxAttempts: 1 })
    } catch {
      continue
    }

    for (const h of hosts) {
      // h.host = "{corp}.fa.us2.oraclecloud.com", h.slug = "{corp}"
      const corp = h.slug.toLowerCase()
      if (!corp || seen.has(corp) || knownCorps.has(corp)) continue
      seen.add(corp)

      const podFull = `${corp}.${pod}` // e.g. "eeho.fa.us2"
      const rawUrl  = `https://${h.host}/hcmUI/CandidateExperience/en/sites/CX_1/requisitions`
      // Partial slug — site name "CX_1" is a common default but may be wrong.
      // The dedicated script will verify and correct it.
      const partialSlug = `${podFull}:CX_1`

      try {
        const r = await pool.query(
          `INSERT INTO discovered_candidates
             (raw_url, ats_type, ats_identifier, source, confidence_score, next_retry_at)
           VALUES ($1,'oraclecloud',$2,$3,40,$4)
           ON CONFLICT (ats_type, ats_identifier) DO NOTHING
           RETURNING id`,
          [
            rawUrl,
            partialSlug,
            `crtsh:oraclecloud:${pod}`,
            new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          ]
        )
        if (r.rowCount && r.rowCount > 0) staged++
      } catch { /* skip */ }
    }
  }

  return staged
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authed = requireCronAuth(req.headers.get("authorization"))
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const skipCrtsh = process.env.DISCOVER_SKIP_CRTSH === "true"
  const skipGithub = process.env.DISCOVER_SKIP_GITHUB === "true"

  const pool = getPostgresPool()
  const result: Record<string, number> = {}

  result.apply_url    = await runApplyUrlDetection(pool)
  result.github_seeds = skipGithub ? 0 : await runGithubSeeds(pool)
  result.crtsh        = skipCrtsh ? 0 : await runCrtshDiscovery(pool)
  result.workday      = skipCrtsh ? 0 : await runWorkdayCrtshDiscovery(pool)
  result.oracle       = skipCrtsh ? 0 : await runOracleCrtshDiscovery(pool)
  result.total        = Object.values(result).reduce((a, b) => a + b, 0) - (result.total ?? 0)

  return NextResponse.json({ ok: true, enrolled: result })
}
