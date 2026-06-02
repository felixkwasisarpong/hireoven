import type { Pool } from "pg"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"
import { guessPublicDomain } from "@/lib/companies/placeholder-from-employer"
import { normalizeCompanyName, companySlug } from "@/lib/harvester/discovery/glassdoor/name-normalization"
import { RobotsCache } from "@/lib/harvester/discovery/glassdoor/robots"
import { GlassdoorRateLimiter } from "@/lib/harvester/discovery/glassdoor/rate-limiter"
import { parseBuiltinCompanies, builtinPageHasCompanies } from "./parser"

/**
 * Built In company-name discovery worker.
 *
 * Built In's /companies grid is server-rendered and robots-permitted, so unlike
 * Glassdoor (robots-blocked) this works with a plain fetch — no browser. We
 * paginate /companies?page=N, parse company names, and enqueue each as a
 * sentinel company row for the resolver (domain/careers/ATS resolution happens
 * downstream). Reuses the glassdoor discovery infrastructure: discovery_jobs
 * queue, RobotsCache, rate limiter, and the discovered_company_candidates table.
 */

const SOURCE = "builtin"
const BASE = "https://builtin.com/companies"
const DEFAULT_USER_AGENT =
  "HireovenBuiltinCompanyDiscoveryBot/1.0 (+https://hireoven.com; bot@hireoven.com)"

export type BuiltinWorkerSummary = {
  ok: boolean
  status: string
  pagesProcessed: number
  requestsSkippedByRobots: number
  companiesFound: number
  candidatesInserted: number
  errorMessage: string | null
}

function intEnv(name: string, fallback: number, min = 1): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : fallback
}

function disabled(): boolean {
  return process.env.BUILTIN_DISCOVERY_DISABLED === "true"
}

/** Seed one discovery_jobs row per page (idempotent). */
async function ensureJobs(pool: Pool, maxPages: number): Promise<void> {
  for (let page = 1; page <= maxPages; page += 1) {
    await pool.query(
      `INSERT INTO discovery_jobs (source, sector_keyword, location_keyword, status, attempts, next_run_at)
       VALUES ($1, 'companies', $2, 'pending', 0, now())
       ON CONFLICT (source, sector_keyword, location_keyword) DO NOTHING`,
      [SOURCE, `page-${page}`]
    )
  }
}

async function claimJobs(pool: Pool, limit: number) {
  const { rows } = await pool.query<{ id: string; location_keyword: string }>(
    `UPDATE discovery_jobs SET status='running', attempts=attempts+1, updated_at=now()
      WHERE id IN (
        SELECT id FROM discovery_jobs
         WHERE source=$1 AND next_run_at <= now()
           AND status IN ('pending','failed','completed','skipped_by_robots')
         ORDER BY location_keyword ASC, next_run_at ASC
         LIMIT $2 FOR UPDATE SKIP LOCKED
      ) RETURNING id, location_keyword`,
    [SOURCE, limit]
  )
  return rows
}

async function finishJob(pool: Pool, id: string, status: string, nextInDays: number, err: string | null) {
  await pool.query(
    `UPDATE discovery_jobs SET status=$2, last_error=$3, next_run_at=now() + ($4 || ' days')::interval, updated_at=now()
      WHERE id=$1`,
    [id, status, err, String(nextInDays)]
  )
}

/** Insert a discovered company as a sentinel row + candidate. Dedup is enforced
 *  by the unique (source, company_name_normalized) and unique companies.domain
 *  constraints, so re-runs are cheap no-ops. Returns true when a NEW company
 *  sentinel was created. */
async function enqueueCompany(
  pool: Pool,
  args: { name: string; slug: string; sourceUrl: string }
): Promise<boolean> {
  const normalized = normalizeCompanyName(args.name)
  if (!normalized) return false

  await pool.query(
    `INSERT INTO discovered_company_candidates
       (company_name_raw, company_name_normalized, source, source_url, status)
     VALUES ($1,$2,$3,$4,'pending')
     ON CONFLICT (source, company_name_normalized)
       DO UPDATE SET last_seen_at = now(), times_seen = discovered_company_candidates.times_seen + 1`,
    [args.name.slice(0, 140), normalized, SOURCE, args.sourceUrl]
  )

  const slug = args.slug || companySlug(args.name)
  if (!slug) return false
  const sentinelDomain = `${slug}.builtin-discovery`
  const guessedDomain = guessPublicDomain(args.name)
  const logoUrl = guessedDomain ? companyLogoUrlFromDomain(guessedDomain) : null

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO companies
       (name, domain, careers_url, logo_url, is_active, ats_type, discovered_via, raw_ats_config)
     VALUES ($1,$2,$3,$4,false,NULL,$5,$6::jsonb)
     ON CONFLICT (domain) DO NOTHING
     RETURNING id`,
    [
      args.name.slice(0, 140),
      sentinelDomain,
      `https://builtin.com/company/${encodeURIComponent(slug)}`,
      logoUrl,
      "builtin:company-discovery",
      JSON.stringify({
        source: "builtin_company_discovery",
        ats_discovery_status: "pending",
        original_display_name: args.name,
        guessed_domain: guessedDomain,
        domain_verified: false,
        source_url: args.sourceUrl,
        created_at: new Date().toISOString(),
      }),
    ]
  )

  if (inserted.rows[0]?.id) {
    await pool.query(
      `UPDATE discovered_company_candidates
          SET status='queued', enqueued_company_id=$2, last_seen_at=now()
        WHERE source=$3 AND company_name_normalized=$1`,
      [normalized, inserted.rows[0].id, SOURCE]
    )
    return true
  }
  return false
}

export async function runBuiltinDiscoveryWorker(opts: { pool: Pool; fetchImpl?: typeof fetch }): Promise<BuiltinWorkerSummary> {
  const summary: BuiltinWorkerSummary = {
    ok: true, status: "completed", pagesProcessed: 0,
    requestsSkippedByRobots: 0, companiesFound: 0, candidatesInserted: 0, errorMessage: null,
  }
  if (disabled()) return { ...summary, status: "disabled" }

  const pool = opts.pool
  const fetchImpl = opts.fetchImpl ?? fetch
  const userAgent = process.env.BUILTIN_DISCOVERY_USER_AGENT ?? DEFAULT_USER_AGENT
  // /companies is a deep directory — pages are fully distinct out to 120+
  // (~10k companies total, matching the full Built In list). Cover it all;
  // pages with no companies past the end are cheap no-ops that re-crawl weekly.
  const maxPages = intEnv("BUILTIN_MAX_PAGES", 500)
  // ~20 pages/run × the 12 req/min limit ≈ 100s, well inside the 300s budget;
  // a full sweep completes in a few days, then weekly re-crawl keeps it fresh.
  const pagesPerRun = intEnv("BUILTIN_PAGES_PER_RUN", 20)
  const timeoutMs = intEnv("BUILTIN_FETCH_TIMEOUT_MS", 15_000, 1_000)

  const robots = new RobotsCache({ fetchImpl, userAgent, timeoutMs })
  const limiter = new GlassdoorRateLimiter({
    minDelayMs: intEnv("BUILTIN_MIN_DELAY_MS", 2_000, 0),
    maxDelayMs: intEnv("BUILTIN_MAX_DELAY_MS", 5_000, 0),
    maxRequestsPerMinute: intEnv("BUILTIN_MAX_REQUESTS_PER_MINUTE", 12),
  })

  try {
    await ensureJobs(pool, maxPages)
    const jobs = await claimJobs(pool, pagesPerRun)
    if (jobs.length === 0) return { ...summary, status: "no_due_jobs" }

    for (const job of jobs) {
      const page = Number.parseInt(job.location_keyword.replace(/^page-/, ""), 10) || 1
      const url = `${BASE}?page=${page}`

      const allowed = await robots.allowed(url)
      if (!allowed.allowed) {
        summary.requestsSkippedByRobots += 1
        await finishJob(pool, job.id, "skipped_by_robots", 7, allowed.reason)
        continue
      }

      await limiter.waitBeforeRequest()
      let html = ""
      try {
        const res = await fetchImpl(url, {
          headers: { "user-agent": userAgent, accept: "text/html" },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "follow",
        })
        if (!res.ok) {
          await finishJob(pool, job.id, "failed", 1, `http_${res.status}`)
          continue
        }
        html = await res.text()
      } catch (err) {
        await finishJob(pool, job.id, "failed", 1, err instanceof Error ? err.message.slice(0, 200) : "fetch_error")
        continue
      }

      summary.pagesProcessed += 1
      const companies = parseBuiltinCompanies(html)
      summary.companiesFound += companies.length
      for (const c of companies) {
        if (await enqueueCompany(pool, { name: c.name, slug: c.slug, sourceUrl: url })) {
          summary.candidatesInserted += 1
        }
      }

      // Re-crawl pages weekly to catch newly-listed companies. A page with no
      // companies is past the end — still revisit weekly in case the list grows.
      void builtinPageHasCompanies(html)
      await finishJob(pool, job.id, "completed", 7, null)
    }

    return summary
  } catch (err) {
    return {
      ...summary, ok: false, status: "error",
      errorMessage: err instanceof Error ? err.message.slice(0, 300) : String(err),
    }
  }
}
