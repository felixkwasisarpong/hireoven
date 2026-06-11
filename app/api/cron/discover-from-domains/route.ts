/**
 * GET /api/cron/discover-from-domains
 *
 * Resolves ATS boards for companies we already hold with a **real guessed
 * domain** but no `ats_type` (mostly aggregator-ingested rows: ~8.7k at time of
 * writing). For each it finds the careers page from the domain, detects the ATS
 * embedded on that page (or via a name-slug probe), and — only if the resolved
 * board currently has live jobs — enrolls the company IN PLACE (sets ats_type /
 * ats_identifier / careers_url, activates it).
 *
 * This is the domain-first complement to `discover-tenants` (which only
 * name-probes). Companies this pass can't crack keep `ats_probe_attempted_at`
 * NULL, so `discover-tenants` still gets to name-probe them — the two compose.
 *
 * Plain-fetch only (no browser): runs fine on the nodejs runtime. JS-only
 * careers pages become misses and fall through to the browser-based discovery.
 *
 * Env:
 *   CRON_SECRET                          required auth header
 *   DISCOVER_FROM_DOMAINS_ENABLED        must be "true" to do anything (safe rollout)
 *   DISCOVER_FROM_DOMAINS_BATCH          companies per run (default 100)
 *   DISCOVER_FROM_DOMAINS_CONCURRENCY    parallel companies (default 8)
 * Query:
 *   ?dry=1                               resolve + probe but never write (measure hit-rate)
 */

import { NextRequest, NextResponse } from "next/server"
import pLimit from "p-limit"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { discoverCareersUrl, type DiscoveryProbe } from "@/lib/companies/careers-url-discovery"
import { resolveDirectAtsUrl } from "@/lib/companies/ats-url-resolver"
import type { Pool } from "pg"

export const runtime = "nodejs"
export const maxDuration = 300

const TIME_BUDGET_MS = 250_000
const CAREERS_FETCH_TIMEOUT_MS = 5_000
const CAREERS_MAX_PATHS = 5
const PER_COMPANY_DEADLINE_MS = 16_000
const JOB_PROBE_TIMEOUT_MS = 8_000
const USER_AGENT =
  process.env.DISCOVER_FROM_DOMAINS_USER_AGENT ??
  "Mozilla/5.0 (compatible; hireoven-discovery/1.0; +https://hireoven.com)"

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Plain HTML fetch used as the DiscoveryProbe — no browser, bounded body.
 * Single local-timeout AbortController only (forwarding a parent signal into an
 * in-flight body read trips a Node/undici ERR_INVALID_STATE crash); the parent
 * deadline still gates scheduling between fetches. Bodies we discard are
 * cancelled so no stream is left dangling.
 */
async function plainFetchHtml(
  url: string,
  timeoutMs = CAREERS_FETCH_TIMEOUT_MS
): Promise<{ ok: boolean; status: number | null; html: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    })
    const contentType = res.headers.get("content-type") ?? ""
    if (!res.ok || !/text\/html|xml/i.test(contentType)) {
      try { await res.body?.cancel() } catch { /* ignore */ }
      return { ok: false, status: res.status, html: null }
    }
    return { ok: true, status: res.status, html: (await res.text()).slice(0, 1_500_000) }
  } catch {
    return { ok: false, status: null, html: null }
  } finally {
    clearTimeout(timer)
  }
}

type ClaimedCompany = { id: string; name: string; domain: string }

type MissReason =
  | "no_careers_page"
  | "no_ats_detected"
  | "unsupported_ats"
  | "ats_already_known"
  | "no_live_jobs"
  | "timeout"

type Counters = {
  claimed: number
  careers_found: number
  ats_detected: number
  has_jobs: number
  would_enroll: number
  enrolled: number
  miss: Record<MissReason, number>
}

/** Resolve one company: domain → careers page → ATS → job gate → enroll. */
async function resolveCompany(
  pool: Pool,
  company: ClaimedCompany,
  dry: boolean,
  counters: Counters
): Promise<void> {
  const deadline = AbortSignal.timeout(PER_COMPANY_DEADLINE_MS)
  const probe: DiscoveryProbe = ({ url }) => plainFetchHtml(url)

  // 1. domain → careers page
  const careers = await discoverCareersUrl({
    domain: company.domain,
    probe,
    maxAttempts: CAREERS_MAX_PATHS,
    signal: deadline,
  })
  if (careers.confidence === "none" || !careers.url) {
    counters.miss[deadline.aborted ? "timeout" : "no_careers_page"] += 1
    return
  }
  counters.careers_found += 1

  // 2. careers page → direct ATS (plain fetch + embedded-link detect + name-slug
  //    probe; no renderHtml — JS-only pages fall through to browser discovery)
  const resolved = await resolveDirectAtsUrl(careers.url, { companyName: company.name })
  if (!resolved) {
    counters.miss.no_ats_detected += 1
    return
  }

  const det = detectAdapter(resolved.directUrl)
  if (!det) {
    counters.miss.unsupported_ats += 1
    return
  }
  counters.ats_detected += 1

  const ats = det.adapter.name
  const slug = det.slug
  const careersUrl = canonicalCareersUrl(ats, slug) ?? resolved.directUrl

  // 3. dedup — another company may already own this exact board
  const dup = await pool.query<{ id: string }>(
    `SELECT id FROM companies
      WHERE ats_type = $1 AND lower(ats_identifier) = lower($2) AND id <> $3
      LIMIT 1`,
    [ats, slug, company.id]
  )
  if (dup.rows[0]) {
    counters.miss.ats_already_known += 1
    if (!dry) {
      await pool
        .query(
          `UPDATE companies SET duplicate_of_company_id = $2, updated_at = now()
            WHERE id = $1 AND duplicate_of_company_id IS NULL`,
          [company.id, dup.rows[0].id]
        )
        .catch(() => { /* non-fatal */ })
    }
    return
  }

  // 4. job-presence gate — never enroll an empty board
  let jobCount = 0
  try {
    const result = await det.adapter.fetchJobs({
      slug,
      ctx: { etag: null, lastModified: null, timeoutMs: JOB_PROBE_TIMEOUT_MS },
    })
    jobCount = result.jobs.length
  } catch {
    jobCount = 0
  }
  if (jobCount === 0) {
    counters.miss.no_live_jobs += 1
    return
  }
  counters.has_jobs += 1
  counters.would_enroll += 1
  if (dry) return

  // 5. enroll IN PLACE (turn the placeholder into a harvestable board)
  const rawConfig = JSON.stringify({
    resolved_via: "domain",
    resolved_source: resolved.source,
    careers_confidence: careers.confidence,
    discovered_job_count: jobCount,
    resolved_at: new Date().toISOString(),
  })
  const updated = await pool.query(
    `UPDATE companies
        SET ats_type = $2,
            ats_identifier = $3,
            careers_url = $4,
            direct_ats_url = $5,
            direct_ats_provider = $6,
            direct_ats_identifier = $7,
            is_active = true,
            status = 'active',
            freshness_tier = COALESCE(freshness_tier, 'tier_2'),
            next_harvest_at = now(),
            raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb) || $8::jsonb,
            updated_at = now()
      WHERE id = $1 AND ats_type IS NULL`,
    [company.id, ats, slug, careersUrl, resolved.directUrl, resolved.provider, resolved.identifier, rawConfig]
  )
  if (updated.rowCount && updated.rowCount > 0) counters.enrolled += 1
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  if (process.env.DISCOVER_FROM_DOMAINS_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" })
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1"
  const startedAt = Date.now()
  const deadline = startedAt + TIME_BUDGET_MS
  const pool = getPostgresPool()

  // Claim a batch of real-domain, unmatched companies and mark them attempted so
  // concurrent/next runs skip them. (Dry runs don't claim — they re-read freely.)
  const claimSelect = `
    SELECT id, name, domain FROM companies
     WHERE ats_type IS NULL
       AND careers_discovery_attempted_at IS NULL
       AND duplicate_of_company_id IS NULL
       AND name IS NOT NULL AND length(trim(name)) >= 2
       AND status <> 'dead'
       AND domain LIKE '%.%'
       AND domain NOT ILIKE '%.placeholder'
       AND domain NOT ILIKE 'adzuna-%'
       AND domain NOT ILIKE 'dice-%'
       AND domain NOT ILIKE '%.invalid'
       AND domain !~* '-discovered$'
       AND domain !~* '\\.(builtin|glassdoor)-discovery$'
     ORDER BY job_count DESC NULLS LAST
     LIMIT $1
     FOR UPDATE SKIP LOCKED`

  const batchSize = intEnv("DISCOVER_FROM_DOMAINS_BATCH", 100)
  const { rows: batch } = dry
    ? await pool.query<ClaimedCompany>(`${claimSelect}`, [batchSize])
    : await pool.query<ClaimedCompany>(
        `UPDATE companies SET careers_discovery_attempted_at = now()
          WHERE id IN (${claimSelect}) RETURNING id, name, domain`,
        [batchSize]
      )

  if (batch.length === 0) {
    return NextResponse.json({ ok: true, message: "no real-domain candidates", enrolled: 0 })
  }

  const counters: Counters = {
    claimed: batch.length,
    careers_found: 0,
    ats_detected: 0,
    has_jobs: 0,
    would_enroll: 0,
    enrolled: 0,
    miss: {
      no_careers_page: 0,
      no_ats_detected: 0,
      unsupported_ats: 0,
      ats_already_known: 0,
      no_live_jobs: 0,
      timeout: 0,
    },
  }

  const limit = pLimit(intEnv("DISCOVER_FROM_DOMAINS_CONCURRENCY", 8))
  let budgetHit = false

  await Promise.all(
    batch.map((company) =>
      limit(async () => {
        if (budgetHit || Date.now() > deadline) {
          budgetHit = true
          return
        }
        try {
          await resolveCompany(pool, company, dry, counters)
        } catch {
          counters.miss.timeout += 1
        }
      })
    )
  )

  if (!dry) {
    await pool
      .query(
        `INSERT INTO discovery_runs (channel, candidates_found, candidates_enrolled, candidates_held, candidates_rejected, duration_ms)
         VALUES ('cron:discover-from-domains', $1, $2, 0, $3, $4)`,
        [counters.claimed, counters.enrolled, counters.miss.no_live_jobs, Date.now() - startedAt]
      )
      .catch(() => { /* non-fatal */ })
  }

  return NextResponse.json({
    ok: true,
    dry,
    budgetHit,
    durationMs: Date.now() - startedAt,
    ...counters,
  })
}
