/**
 * GET /api/cron/discover-from-domains
 *
 * Two stages in one pass:
 *   0. RESOLVE — name-only placeholder companies (`<slug>.placeholder`,
 *      `<slug>.builtin-discovery`) with no domain get a real domain guessed from
 *      their name and written to `raw_ats_config.guessed_domain` (precision-first
 *      heuristic resolver). This feeds stage 1 the same run.
 *   1. ENROLL — companies we hold with a **real or guessed domain** but no
 *      `ats_type` (aggregator-ingested rows, discovery placeholders, and the
 *      stage-0 resolutions). For each it finds the careers page from the domain,
 *      detects the ATS embedded on that page (or via a name-slug probe), and —
 *      only if the resolved board currently has live jobs — enrolls the company
 *      IN PLACE (sets ats_type / ats_identifier / careers_url, activates it).
 *
 * If no supported ATS is detected but the careers page has enough job-listing
 * evidence, the company is promoted to `ats_type = 'custom'` and queued for the
 * non-ATS crawler. This gives discovered companies a pure crawling lane without
 * sending them through the supported-ATS harvester.
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
 *   DISCOVER_FROM_DOMAINS_PROMOTE_CUSTOM set to "false" to disable custom-crawl promotion
 *   DISCOVER_FROM_DOMAINS_CUSTOM_MIN_CONFIDENCE high|medium|low (default medium)
 *   DISCOVER_FROM_DOMAINS_RETRY_AFTER_HOURS retry older unmatched attempts (default 72)
 *   DISCOVER_FROM_DOMAINS_RESOLVE_BATCH  name-only companies to domain-resolve per run (default 50; 0 disables stage 0)
 *   DISCOVER_FROM_DOMAINS_RESOLVE_CONCURRENCY parallel resolutions (default 6)
 *   DISCOVER_FROM_DOMAINS_RESOLVE_RETRY_HOURS re-attempt a resolution miss after N hours (default 168)
 *   DISCOVER_FROM_DOMAINS_ENABLE_CLEARBIT set to "true" to also try Clearbit autocomplete (lower precision; off by default)
 * Query:
 *   ?dry=1                               resolve + probe but never write (measure hit-rate)
 *   ?batch=100&concurrency=8             override batch/concurrency
 */

import { NextRequest, NextResponse } from "next/server"
import pLimit from "p-limit"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { discoverCareersUrl, type DiscoveryProbe } from "@/lib/companies/careers-url-discovery"
import { resolveDirectAtsUrl } from "@/lib/companies/ats-url-resolver"
import { resolveCompanyDomainFromName } from "@/lib/companies/domain-resolution"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"
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

function intParamOrEnv(params: URLSearchParams, param: string, env: string, fallback: number): number {
  const fromParam = Number.parseInt(params.get(param) ?? "", 10)
  if (Number.isFinite(fromParam) && fromParam > 0) return fromParam
  return intEnv(env, fallback)
}

function confidenceRank(confidence: string): number {
  switch (confidence) {
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
    default:
      return 0
  }
}

function customMinConfidenceRank(): number {
  const raw = (process.env.DISCOVER_FROM_DOMAINS_CUSTOM_MIN_CONFIDENCE ?? "medium")
    .trim()
    .toLowerCase()
  return confidenceRank(raw)
}

function customPromotionEnabled(): boolean {
  return process.env.DISCOVER_FROM_DOMAINS_PROMOTE_CUSTOM !== "false"
}

function normalizedDomainSql(expr: string): string {
  return `NULLIF(split_part(regexp_replace(lower(trim(COALESCE(${expr}, ''))), '^https?://(www\\.)?', ''), '/', 1), '')`
}

function realCompanyDomainPredicate(expr: string): string {
  return `(
    ${expr} IS NOT NULL
    AND ${expr} LIKE '%.%'
    AND ${expr} NOT ILIKE '%.placeholder'
    AND ${expr} NOT ILIKE '%.invalid'
    AND ${expr} NOT ILIKE '%.ats-placeholder'
    AND ${expr} NOT ILIKE '%.lca-employer'
    AND ${expr} NOT ILIKE '%.uscis-employer'
    AND ${expr} NOT ILIKE 'adzuna-%'
    AND ${expr} NOT ILIKE 'dice-%'
    AND ${expr} !~* '-discovered$'
    AND ${expr} !~* '\\.(builtin|glassdoor)-discovery$'
    AND ${expr} !~* '(^|\\.)(linkedin|indeed|glassdoor|dice|builtin|adzuna|ziprecruiter|monster|careerbuilder)\\.com$'
    AND ${expr} !~* '(^|\\.)(myworkdayjobs|workdayjobs|greenhouse|lever|ashbyhq|smartrecruiters|icims|jobvite|taleo|bamboohr|workable|recruitee|successfactors)\\.'
  )`
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

type ClaimedCompany = {
  id: string
  name: string
  domain: string
  effective_domain: string
  effective_domain_source: "domain" | "guessed_domain"
}

type MissReason =
  | "no_careers_page"
  | "no_ats_detected"
  | "unsupported_ats"
  | "ats_already_known"
  | "domain_already_known"
  | "no_live_jobs"
  | "low_confidence_careers"
  | "custom_disabled"
  | "timeout"

type Counters = {
  claimed: number
  careers_found: number
  ats_detected: number
  has_jobs: number
  would_enroll: number
  enrolled: number
  custom_would_promote: number
  custom_promoted: number
  miss: Record<MissReason, number>
}

function canPromoteCustom(careers: { confidence: string }): boolean {
  return confidenceRank(careers.confidence) >= customMinConfidenceRank()
}

async function promoteCustomCrawlCompany(
  pool: Pool,
  company: ClaimedCompany,
  careers: { url: string; confidence: string; reason: string },
  dry: boolean,
  counters: Counters,
  fallbackMiss: "no_ats_detected" | "unsupported_ats"
) {
  if (!customPromotionEnabled()) {
    counters.miss.custom_disabled += 1
    counters.miss[fallbackMiss] += 1
    return
  }
  if (!canPromoteCustom(careers)) {
    counters.miss.low_confidence_careers += 1
    counters.miss[fallbackMiss] += 1
    return
  }

  counters.custom_would_promote += 1
  if (dry) return

  const duplicate = await pool.query<{ id: string }>(
    `SELECT id
       FROM companies
      WHERE lower(domain) = lower($1)
        AND id <> $2
        AND duplicate_of_company_id IS NULL
      LIMIT 1`,
    [company.effective_domain, company.id]
  )
  if (duplicate.rows[0]) {
    counters.miss.domain_already_known += 1
    await pool
      .query(
        `UPDATE companies
            SET duplicate_of_company_id = $2,
                updated_at = now()
          WHERE id = $1 AND duplicate_of_company_id IS NULL`,
        [company.id, duplicate.rows[0].id]
      )
      .catch(() => { /* non-fatal */ })
    return
  }

  const rawConfig = JSON.stringify({
    resolved_via: "domain",
    resolved_source: "custom_crawl",
    effective_domain: company.effective_domain,
    effective_domain_source: company.effective_domain_source,
    domain_verified: true,
    ats_discovery_status: "custom_crawl_ready",
    careers_confidence: careers.confidence,
    careers_reason: careers.reason,
    crawl_allowed: true,
    promoted_to_custom_crawl_at: new Date().toISOString(),
  })

  const updated = await pool.query(
    `UPDATE companies
        SET domain = $2,
            careers_url = $3,
            ats_type = 'custom',
            ats_identifier = NULL,
            direct_ats_url = NULL,
            direct_ats_provider = NULL,
            direct_ats_identifier = NULL,
            is_active = true,
            status = 'active',
            freshness_tier = 'tier_3',
            next_harvest_at = now(),
            raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb) || $4::jsonb,
            updated_at = now()
      WHERE id = $1
        AND ats_type IS NULL
        AND duplicate_of_company_id IS NULL`,
    [company.id, company.effective_domain, careers.url, rawConfig]
  )
  if (updated.rowCount && updated.rowCount > 0) counters.custom_promoted += 1
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
    domain: company.effective_domain,
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
    await promoteCustomCrawlCompany(pool, company, careers, dry, counters, "no_ats_detected")
    return
  }

  const det = detectAdapter(resolved.directUrl)
  if (!det) {
    await promoteCustomCrawlCompany(pool, company, careers, dry, counters, "unsupported_ats")
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
    effective_domain: company.effective_domain,
    effective_domain_source: company.effective_domain_source,
    domain_verified: true,
    ats_discovery_status: "checked",
    careers_confidence: careers.confidence,
    careers_reason: careers.reason,
    discovered_job_count: jobCount,
    resolved_at: new Date().toISOString(),
  })
  const updated = await pool.query(
    `UPDATE companies
        SET domain = CASE
              WHEN NOT EXISTS (
                SELECT 1 FROM companies x
                 WHERE lower(x.domain) = lower($9) AND x.id <> companies.id
              )
              THEN $9
              ELSE domain
            END,
            ats_type = $2,
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
    [company.id, ats, slug, careersUrl, resolved.directUrl, resolved.provider, resolved.identifier, rawConfig, company.effective_domain]
  )
  if (updated.rowCount && updated.rowCount > 0) counters.enrolled += 1
}

type ResolveStats = { attempted: number; resolved: number; missed: number; byMethod: Record<string, number> }

/**
 * Pre-phase: resolve a real domain for name-only placeholder companies
 * (`<slug>.placeholder`, `<slug>.builtin-discovery`) that have no real domain
 * and no prior guess. The resolved domain is written to
 * `raw_ats_config.guessed_domain` — the exact field the claim below reads — so
 * freshly-resolved companies flow into careers/ATS detection in THIS same run
 * (they still have `careers_discovery_attempted_at = NULL`). A guess never
 * touches the canonical `companies.domain`; downstream ATS verification is the
 * safety net for a wrong guess.
 */
async function resolveGuessedDomains(
  pool: Pool,
  params: URLSearchParams,
  deadline: number,
  dry: boolean
): Promise<ResolveStats> {
  const stats: ResolveStats = { attempted: 0, resolved: 0, missed: 0, byMethod: {} }
  const batch = intParamOrEnv(params, "resolveBatch", "DISCOVER_FROM_DOMAINS_RESOLVE_BATCH", 50)
  if (batch <= 0) return stats
  const retryHours = intEnv("DISCOVER_FROM_DOMAINS_RESOLVE_RETRY_HOURS", 168)
  const disableClearbit = process.env.DISCOVER_FROM_DOMAINS_ENABLE_CLEARBIT !== "true"

  const select = `
    SELECT c.id, c.name
      FROM companies c
     WHERE c.ats_type IS NULL
       AND c.duplicate_of_company_id IS NULL
       AND COALESCE(c.status, 'active') <> 'dead'
       AND c.name IS NOT NULL AND length(trim(c.name)) >= 2
       AND (c.domain ILIKE '%.placeholder' OR c.domain ILIKE '%.builtin-discovery')
       AND COALESCE(c.raw_ats_config->>'guessed_domain', '') = ''
       AND (
         c.raw_ats_config->>'domain_resolution_attempted_at' IS NULL
         OR (c.raw_ats_config->>'domain_resolution_attempted_at')::timestamptz
              < now() - ($2::int || ' hours')::interval
       )
     ORDER BY c.job_count DESC NULLS LAST, c.created_at ASC NULLS LAST
     LIMIT $1
     FOR UPDATE OF c SKIP LOCKED`

  // Claim (and stamp the attempt) so concurrent/next runs skip these rows.
  const { rows } = dry
    ? await pool.query<{ id: string; name: string }>(select, [batch, retryHours])
    : await pool.query<{ id: string; name: string }>(
        `WITH candidates AS (${select}),
              claimed AS (
                UPDATE companies c
                   SET raw_ats_config = COALESCE(c.raw_ats_config, '{}'::jsonb)
                         || jsonb_build_object('domain_resolution_attempted_at', to_jsonb(now())),
                       updated_at = now()
                  FROM candidates
                 WHERE c.id = candidates.id
                 RETURNING c.id, c.name
              )
         SELECT * FROM claimed`,
        [batch, retryHours]
      )
  if (rows.length === 0) return stats

  const limit = pLimit(intParamOrEnv(params, "resolveConcurrency", "DISCOVER_FROM_DOMAINS_RESOLVE_CONCURRENCY", 6))
  await Promise.all(
    rows.map((company) =>
      limit(async () => {
        if (Date.now() > deadline) return
        stats.attempted += 1
        let resolved
        try {
          resolved = await resolveCompanyDomainFromName(company.name, { timeoutMs: 6_000, disableClearbit })
        } catch {
          stats.missed += 1
          return
        }
        if (!resolved) {
          stats.missed += 1
          return
        }
        stats.resolved += 1
        stats.byMethod[resolved.method] = (stats.byMethod[resolved.method] ?? 0) + 1
        if (dry) return
        const logoUrl = companyLogoUrlFromDomain(resolved.domain)
        await pool.query(
          `UPDATE companies
              SET raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb)
                    || jsonb_build_object(
                         'guessed_domain', $2::text,
                         'domain_resolution', jsonb_build_object(
                           'domain', $2::text, 'method', $3::text,
                           'confidence', $4::text, 'resolved_at', to_jsonb(now())
                         )
                       ),
                  logo_url = CASE
                    WHEN (logo_url IS NULL OR logo_url = '') AND $5 <> '' THEN $5
                    ELSE logo_url END,
                  updated_at = now()
            WHERE id = $1`,
          [company.id, resolved.domain, resolved.method, resolved.confidence, logoUrl]
        )
      })
    )
  )
  return stats
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  if (process.env.DISCOVER_FROM_DOMAINS_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" })
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1"
  const params = new URL(req.url).searchParams
  const startedAt = Date.now()
  const deadline = startedAt + TIME_BUDGET_MS
  const pool = getPostgresPool()
  const retryAfterHours = intEnv("DISCOVER_FROM_DOMAINS_RETRY_AFTER_HOURS", 72)

  // Pre-phase: give name-only placeholder companies a guessed_domain so the
  // claim below can pick them up (this run or the next).
  const resolveStats = await resolveGuessedDomains(pool, params, deadline, dry)

  // Claim a batch of real-domain, unmatched companies and mark them attempted so
  // concurrent/next runs skip them. (Dry runs don't claim — they re-read freely.)
  const normalizedDomain = normalizedDomainSql("c.domain")
  const guessedDomain = normalizedDomainSql("c.raw_ats_config->>'guessed_domain'")
  const normalizedDomainLooksReal = realCompanyDomainPredicate("d.normalized_domain")
  const guessedDomainLooksReal = realCompanyDomainPredicate("d.guessed_domain")
  const claimSelect = `
    SELECT c.id,
           c.name,
           c.domain,
           CASE
             WHEN ${normalizedDomainLooksReal} THEN d.normalized_domain
             ELSE d.guessed_domain
           END AS effective_domain,
           CASE
             WHEN ${normalizedDomainLooksReal} THEN 'domain'
             ELSE 'guessed_domain'
           END AS effective_domain_source
      FROM companies c
      CROSS JOIN LATERAL (
        SELECT ${normalizedDomain} AS normalized_domain,
               ${guessedDomain} AS guessed_domain
      ) d
     WHERE c.ats_type IS NULL
       AND c.duplicate_of_company_id IS NULL
       AND c.name IS NOT NULL AND length(trim(c.name)) >= 2
       AND COALESCE(c.status, 'active') <> 'dead'
       AND (
         c.careers_discovery_attempted_at IS NULL
         OR c.careers_discovery_attempted_at < now() - ($2::int || ' hours')::interval
       )
       AND (${normalizedDomainLooksReal} OR ${guessedDomainLooksReal})
     ORDER BY c.job_count DESC NULLS LAST, c.created_at ASC NULLS LAST
     LIMIT $1
     FOR UPDATE OF c SKIP LOCKED`

  const batchSize = intParamOrEnv(params, "batch", "DISCOVER_FROM_DOMAINS_BATCH", 100)
  const { rows: batch } = dry
    ? await pool.query<ClaimedCompany>(`${claimSelect}`, [batchSize, retryAfterHours])
    : await pool.query<ClaimedCompany>(
        `WITH candidates AS (${claimSelect}),
              claimed AS (
                UPDATE companies c
                   SET careers_discovery_attempted_at = now(),
                       updated_at = now()
                  FROM candidates
                 WHERE c.id = candidates.id
                 RETURNING c.id,
                           c.name,
                           c.domain,
                           candidates.effective_domain,
                           candidates.effective_domain_source
              )
         SELECT * FROM claimed`,
        [batchSize, retryAfterHours]
      )

  if (batch.length === 0) {
    return NextResponse.json({ ok: true, message: "no real-domain candidates", enrolled: 0, resolved_domains: resolveStats })
  }

  const counters: Counters = {
    claimed: batch.length,
    careers_found: 0,
    ats_detected: 0,
    has_jobs: 0,
    would_enroll: 0,
    enrolled: 0,
    custom_would_promote: 0,
    custom_promoted: 0,
    miss: {
      no_careers_page: 0,
      no_ats_detected: 0,
      unsupported_ats: 0,
      ats_already_known: 0,
      domain_already_known: 0,
      no_live_jobs: 0,
      low_confidence_careers: 0,
      custom_disabled: 0,
      timeout: 0,
    },
  }

  const limit = pLimit(intParamOrEnv(params, "concurrency", "DISCOVER_FROM_DOMAINS_CONCURRENCY", 8))
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
        [
          counters.claimed,
          counters.enrolled + counters.custom_promoted,
          counters.miss.no_live_jobs,
          Date.now() - startedAt,
        ]
      )
      .catch(() => { /* non-fatal */ })
  }

  return NextResponse.json({
    ok: true,
    dry,
    budgetHit,
    durationMs: Date.now() - startedAt,
    resolved_domains: resolveStats,
    ...counters,
  })
}
