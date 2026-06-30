import type { Pool, PoolClient } from "pg"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"
import { guessPublicDomain } from "@/lib/companies/placeholder-from-employer"
import { buildGlassdoorSearchUrl, loadGlassdoorDiscoveryConfig, type GlassdoorDiscoveryConfig } from "./config"
import { harvesterFetch } from "@/lib/harvester/http-agent"
import { detectGlassdoorBlockSignal } from "./block-signals"
import { companySlug, normalizeCompanyName } from "./name-normalization"
import { parseGlassdoorCompanyCandidates, type GlassdoorParsedCompany } from "./parser"
import { GlassdoorRateLimiter } from "./rate-limiter"
import { RobotsCache } from "./robots"

const SOURCE = "glassdoor"
const DEFAULT_USER_AGENT =
  "HireovenGlassdoorCompanyDiscoveryBot/1.0 (+https://hireoven.com; bot@hireoven.com)"
const ADVISORY_LOCK_KEY_1 = 417_129
const ADVISORY_LOCK_KEY_2 = 20_260_601

export type GlassdoorDiscoveryJobRow = {
  id: string
  source: string
  sector_keyword: string
  location_keyword: string
  status: string
  attempts: number
  next_run_at: Date | string | null
  last_error: string | null
}

export type GlassdoorWorkerSummary = {
  ok: boolean
  status: string
  jobsEnqueued: number
  jobsClaimed: number
  requestsAttempted: number
  requestsSkippedByRobots: number
  companiesFound: number
  candidatesInserted: number
  resolverEnqueued: number
  duplicatesSkipped: number
  errorMessage: string | null
}

type RuntimeLimits = {
  maxRequestsPerRun: number
  maxRequestsPerMinute: number
  dailyRequestBudget: number
  minDelayMs: number
  maxDelayMs: number
  timeoutMs: number
  batchSize: number
  jobIntervalHours: number
}

export type RunGlassdoorDiscoveryOptions = {
  pool: Pool
  fetchImpl?: typeof fetch
  config?: GlassdoorDiscoveryConfig
  enqueueJobs?: boolean
  processJobs?: boolean
  userAgent?: string
}

class RequestBudgetExceededError extends Error {
  constructor() {
    super("glassdoor request budget reached")
  }
}

class SourceBlockedError extends Error {
  constructor(message: string) {
    super(message)
  }
}

function intEnv(name: string, fallback: number, min = 0): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

function glassdoorEnabled(): boolean {
  return process.env.GLASSDOOR_DISCOVERY_ENABLED === "true"
}

function runtimeLimits(): RuntimeLimits {
  const maxRequestsPerRun = intEnv("GLASSDOOR_MAX_REQUESTS_PER_RUN", 8, 1)
  return {
    maxRequestsPerRun,
    maxRequestsPerMinute: intEnv("GLASSDOOR_MAX_REQUESTS_PER_MINUTE", 6, 1),
    dailyRequestBudget: intEnv("GLASSDOOR_DAILY_REQUEST_BUDGET", 40, 1),
    minDelayMs: intEnv("GLASSDOOR_MIN_DELAY_MS", 4_000, 0),
    maxDelayMs: intEnv("GLASSDOOR_MAX_DELAY_MS", 12_000, 0),
    timeoutMs: intEnv("GLASSDOOR_FETCH_TIMEOUT_MS", 12_000, 1_000),
    batchSize: intEnv("GLASSDOOR_DISCOVERY_BATCH_SIZE", maxRequestsPerRun, 1),
    jobIntervalHours: intEnv("GLASSDOOR_DISCOVERY_JOB_INTERVAL_HOURS", 24, 1),
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

async function countRequestsToday(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ requests: string }>(
    `SELECT COALESCE(SUM(requests_attempted), 0)::text AS requests
       FROM source_run_logs
      WHERE source = $1
        AND run_started_at >= date_trunc('day', now())`,
    [SOURCE]
  )
  return Number.parseInt(rows[0]?.requests ?? "0", 10) || 0
}

async function tryAcquireWorkerLock(pool: Pool): Promise<PoolClient | null> {
  const client = await pool.connect()
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1, $2) AS locked`,
      [ADVISORY_LOCK_KEY_1, ADVISORY_LOCK_KEY_2]
    )
    if (rows[0]?.locked === true) return client
    client.release()
    return null
  } catch (error) {
    client.release()
    throw error
  }
}

async function releaseWorkerLock(client: PoolClient): Promise<void> {
  try {
    await client.query(`SELECT pg_advisory_unlock($1, $2)`, [
      ADVISORY_LOCK_KEY_1,
      ADVISORY_LOCK_KEY_2,
    ])
  } finally {
    client.release()
  }
}

async function insertRunLog(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO source_run_logs
       (source, run_started_at, requests_attempted, requests_skipped_by_robots,
        companies_found, duplicates_skipped, status)
     VALUES ($1, now(), 0, 0, 0, 0, 'running')
     RETURNING id`,
    [SOURCE]
  )
  return rows[0]!.id
}

async function finishRunLog(
  pool: Pool,
  logId: string,
  summary: Omit<GlassdoorWorkerSummary, "ok" | "jobsEnqueued" | "jobsClaimed" | "candidatesInserted" | "resolverEnqueued">,
): Promise<void> {
  await pool.query(
    `UPDATE source_run_logs
        SET run_finished_at = now(),
            requests_attempted = $2,
            requests_skipped_by_robots = $3,
            companies_found = $4,
            duplicates_skipped = $5,
            status = $6,
            error_message = $7
      WHERE id = $1`,
    [
      logId,
      summary.requestsAttempted,
      summary.requestsSkippedByRobots,
      summary.companiesFound,
      summary.duplicatesSkipped,
      summary.status,
      summary.errorMessage,
    ]
  )
}

export async function ensureGlassdoorDiscoveryJobs(
  pool: Pool,
  config: GlassdoorDiscoveryConfig
): Promise<number> {
  let inserted = 0
  for (const sector of config.sector_keywords) {
    for (const location of config.location_keywords) {
      const result = await pool.query(
        `INSERT INTO discovery_jobs
           (source, sector_keyword, location_keyword, status, attempts, next_run_at)
         VALUES ($1, $2, $3, 'pending', 0, now())
         ON CONFLICT (source, sector_keyword, location_keyword) DO NOTHING`,
        [SOURCE, sector, location]
      )
      inserted += result.rowCount ?? 0
    }
  }
  return inserted
}

async function claimDiscoveryJobs(pool: Pool, limit: number): Promise<GlassdoorDiscoveryJobRow[]> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const { rows } = await client.query<GlassdoorDiscoveryJobRow>(
      `UPDATE discovery_jobs
          SET status = 'running',
              attempts = attempts + 1,
              updated_at = now()
        WHERE id IN (
          SELECT id
            FROM discovery_jobs
           WHERE source = $1
             AND status IN ('pending', 'failed', 'completed', 'skipped_by_robots')
             AND next_run_at <= now()
           ORDER BY next_run_at ASC, updated_at ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, source, sector_keyword, location_keyword, status, attempts, next_run_at, last_error`,
      [SOURCE, limit]
    )
    await client.query("COMMIT")
    return rows
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function releaseUnprocessedJobs(pool: Pool, jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return
  await pool.query(
    `UPDATE discovery_jobs
        SET status = 'pending',
            updated_at = now()
      WHERE id = ANY($1::uuid[])
        AND status = 'running'`,
    [jobIds]
  )
}

async function markJobStatus(
  pool: Pool,
  jobId: string,
  status: string,
  lastError: string | null,
  nextRunAtIso: string
): Promise<void> {
  await pool.query(
    `UPDATE discovery_jobs
        SET status = $2,
            last_error = $3,
            next_run_at = $4::timestamptz,
            updated_at = now()
      WHERE id = $1`,
    [jobId, status, lastError, nextRunAtIso]
  )
}

async function markSourceBlocked(pool: Pool, reason: string): Promise<void> {
  await pool.query(
    `UPDATE discovery_jobs
        SET status = 'blocked',
            last_error = $2,
            updated_at = now()
      WHERE source = $1
        AND status <> 'blocked'`,
    [SOURCE, reason]
  )
}

async function insertDiscoveredCandidate(
  pool: Pool,
  candidate: GlassdoorParsedCompany
): Promise<{ id: string; inserted: boolean; enqueuedCompanyId: string | null }> {
  const existing = await pool.query<{ id: string; enqueued_company_id: string | null }>(
    `SELECT id, enqueued_company_id
       FROM discovered_company_candidates
      WHERE source = $1 AND company_name_normalized = $2
      LIMIT 1`,
    [SOURCE, candidate.companyNameNormalized]
  )
  const existingRow = existing.rows[0]
  if (existingRow) {
    await pool.query(
      `UPDATE discovered_company_candidates
          SET last_seen_at = now(),
              times_seen = times_seen + 1,
              source_url = COALESCE(source_url, $2),
              sector_keyword = COALESCE(sector_keyword, $3),
              location_keyword = COALESCE(location_keyword, $4),
              metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $5::jsonb
        WHERE id = $1`,
      [
        existingRow.id,
        candidate.sourceUrl,
        candidate.discoveredSectorKeyword,
        candidate.discoveredLocationKeyword,
        JSON.stringify({
          last_source_url: candidate.sourceUrl,
          last_sector_keyword: candidate.discoveredSectorKeyword,
          last_location_keyword: candidate.discoveredLocationKeyword,
        }),
      ]
    )
    return { id: existingRow.id, inserted: false, enqueuedCompanyId: existingRow.enqueued_company_id }
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO discovered_company_candidates
       (company_name_raw, company_name_normalized, source, source_url,
        sector_keyword, location_keyword, metadata_json, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending')
     RETURNING id`,
    [
      candidate.companyNameRaw,
      candidate.companyNameNormalized,
      SOURCE,
      candidate.sourceUrl,
      candidate.discoveredSectorKeyword,
      candidate.discoveredLocationKeyword,
      JSON.stringify(candidate.metadata ?? {}),
    ]
  )
  return { id: rows[0]!.id, inserted: true, enqueuedCompanyId: null }
}

async function enqueueCandidateIntoResolver(
  pool: Pool,
  candidateId: string,
  candidate: GlassdoorParsedCompany
): Promise<boolean> {
  const compactName = candidate.companyNameNormalized.replace(/\s+/g, "")
  const alreadyKnown = await pool.query<{ id: string }>(
    `SELECT id
       FROM companies
      WHERE lower(regexp_replace(name, '[^a-z0-9]+', '', 'g')) = $1
         OR raw_ats_config->>'glassdoor_company_normalized' = $2
      LIMIT 1`,
    [compactName, candidate.companyNameNormalized]
  )
  const knownId = alreadyKnown.rows[0]?.id
  if (knownId) {
    await pool.query(
      `UPDATE discovered_company_candidates
          SET status = 'already_known',
              enqueued_company_id = $2,
              last_seen_at = now()
        WHERE id = $1`,
      [candidateId, knownId]
    )
    return false
  }

  const slug = companySlug(candidate.companyNameRaw) || `glassdoor-${candidateId.slice(0, 8)}`
  const sentinelDomain = `${slug}.glassdoor-discovery`
  const guessedDomain = guessPublicDomain(candidate.companyNameRaw)
  const logoUrl = guessedDomain ? companyLogoUrlFromDomain(guessedDomain) : null
  const rawAtsConfig = {
    source: "glassdoor_company_discovery",
    ats_discovery_status: "pending",
    original_display_name: candidate.companyNameRaw,
    glassdoor_company_normalized: candidate.companyNameNormalized,
    glassdoor_candidate_id: candidateId,
    source_url: candidate.sourceUrl,
    sector_keyword: candidate.discoveredSectorKeyword,
    location_keyword: candidate.discoveredLocationKeyword,
    guessed_domain: guessedDomain,
    domain_verified: false,
    created_via: "glassdoor_discovery_worker",
    created_at: new Date().toISOString(),
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO companies
       (name, domain, careers_url, logo_url, is_active, ats_type, discovered_via, raw_ats_config)
     VALUES ($1, $2, $3, $4, false, NULL, $5, $6::jsonb)
     ON CONFLICT (domain) DO NOTHING
     RETURNING id`,
    [
      candidate.companyNameRaw.slice(0, 140),
      sentinelDomain,
      `https://hireoven.invalid/discovery-placeholder/glassdoor/${encodeURIComponent(slug)}`,
      logoUrl,
      "glassdoor:company-discovery",
      JSON.stringify(rawAtsConfig),
    ]
  )

  const companyId =
    inserted.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        `SELECT id FROM companies WHERE domain = $1 LIMIT 1`,
        [sentinelDomain]
      )
    ).rows[0]?.id

  if (!companyId) return false

  await pool.query(
    `UPDATE discovered_company_candidates
        SET status = 'queued',
            enqueued_company_id = $2,
            last_seen_at = now()
      WHERE id = $1`,
    [candidateId, companyId]
  )
  return Boolean(inserted.rows[0]?.id)
}

async function fetchPage(args: {
  url: string
  fetchImpl: typeof fetch
  userAgent: string
  timeoutMs: number
  beforeRequest: () => Promise<void>
  onRequestAttempt: (url: string) => void
}): Promise<{ html: string; finalUrl: string; status: number }> {
  await args.beforeRequest()
  args.onRequestAttempt(args.url)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs)
  try {
    const response = await args.fetchImpl(args.url, {
      headers: { "user-agent": args.userAgent },
      redirect: "follow",
      signal: controller.signal,
    })
    const html = await response.text().catch(() => "")
    return { html, finalUrl: response.url || args.url, status: response.status }
  } finally {
    clearTimeout(timer)
  }
}

export async function runGlassdoorDiscoveryWorker(
  options: RunGlassdoorDiscoveryOptions
): Promise<GlassdoorWorkerSummary> {
  if (!glassdoorEnabled()) {
    return {
      ok: true,
      status: "disabled",
      jobsEnqueued: 0,
      jobsClaimed: 0,
      requestsAttempted: 0,
      requestsSkippedByRobots: 0,
      companiesFound: 0,
      candidatesInserted: 0,
      resolverEnqueued: 0,
      duplicatesSkipped: 0,
      errorMessage: null,
    }
  }

  const pool = options.pool
  const config = options.config ?? loadGlassdoorDiscoveryConfig()
  const limits = runtimeLimits()
  const userAgent = options.userAgent ?? process.env.GLASSDOOR_USER_AGENT ?? DEFAULT_USER_AGENT
  const fetchImpl = options.fetchImpl ?? harvesterFetch
  const lockClient = await tryAcquireWorkerLock(pool)

  if (!lockClient) {
    return {
      ok: true,
      status: "already_running",
      jobsEnqueued: 0,
      jobsClaimed: 0,
      requestsAttempted: 0,
      requestsSkippedByRobots: 0,
      companiesFound: 0,
      candidatesInserted: 0,
      resolverEnqueued: 0,
      duplicatesSkipped: 0,
      errorMessage: null,
    }
  }

  let jobsEnqueued = 0
  let jobsClaimed = 0
  let requestsAttempted = 0
  let requestsSkippedByRobots = 0
  let companiesFound = 0
  let candidatesInserted = 0
  let resolverEnqueued = 0
  let duplicatesSkipped = 0
  let requestsThisRun = 0
  let dailyRequestsAtStart: number
  try {
    dailyRequestsAtStart = await countRequestsToday(pool)
  } catch (error) {
    await releaseWorkerLock(lockClient).catch(() => undefined)
    throw error
  }

  const limiter = new GlassdoorRateLimiter({
    maxRequestsPerMinute: limits.maxRequestsPerMinute,
    minDelayMs: limits.minDelayMs,
    maxDelayMs: limits.maxDelayMs,
  })

  const canRequest = () =>
    requestsThisRun < limits.maxRequestsPerRun &&
    dailyRequestsAtStart + requestsThisRun < limits.dailyRequestBudget

  const beforeRequest = async () => {
    if (!canRequest()) throw new RequestBudgetExceededError()
    await limiter.waitBeforeRequest()
  }
  const onRequestAttempt = () => {
    requestsAttempted += 1
    requestsThisRun += 1
  }

  const robots = new RobotsCache({
    fetchImpl,
    userAgent,
    timeoutMs: limits.timeoutMs,
    beforeRequest,
    onRequestAttempt,
  })

  let logId: string
  try {
    logId = await insertRunLog(pool)
  } catch (error) {
    await releaseWorkerLock(lockClient).catch(() => undefined)
    throw error
  }
  let status = "completed"
  let errorMessage: string | null = null
  let claimedJobs: GlassdoorDiscoveryJobRow[] = []
  const processedJobIds = new Set<string>()

  try {
    if (options.enqueueJobs !== false) {
      jobsEnqueued = await ensureGlassdoorDiscoveryJobs(pool, config)
    }

    if (options.processJobs === false) {
      status = "completed"
      return {
        ok: true,
        status,
        jobsEnqueued,
        jobsClaimed,
        requestsAttempted,
        requestsSkippedByRobots,
        companiesFound,
        candidatesInserted,
        resolverEnqueued,
        duplicatesSkipped,
        errorMessage,
      }
    }

    const claimLimit = Math.min(limits.batchSize, limits.maxRequestsPerRun)
    claimedJobs = await claimDiscoveryJobs(pool, claimLimit)
    jobsClaimed = claimedJobs.length

    for (const job of claimedJobs) {
      if (!canRequest()) {
        status = "budget_exhausted"
        break
      }

      processedJobIds.add(job.id)
      const nextRunAt = iso(Date.now() + limits.jobIntervalHours * 60 * 60 * 1000)
      const targetUrl = buildGlassdoorSearchUrl({
        template: config.search_url_template,
        sectorKeyword: job.sector_keyword,
        locationKeyword: job.location_keyword,
        page: 1,
      })

      const robotsResult = await robots.allowed(targetUrl)
      if (!robotsResult.allowed) {
        requestsSkippedByRobots += 1
        await markJobStatus(pool, job.id, "skipped_by_robots", robotsResult.reason, nextRunAt)
        continue
      }

      let page
      try {
        page = await fetchPage({
          url: targetUrl,
          fetchImpl,
          userAgent,
          timeoutMs: limits.timeoutMs,
          beforeRequest,
          onRequestAttempt,
        })
      } catch (error) {
        if (error instanceof RequestBudgetExceededError) {
          status = "budget_exhausted"
          break
        }
        const message = error instanceof Error ? error.message : String(error)
        await markJobStatus(pool, job.id, "failed", message, nextRunAt)
        continue
      }

      const block = detectGlassdoorBlockSignal({
        status: page.status,
        finalUrl: page.finalUrl,
        html: page.html,
      })
      if (block.blocked) {
        const reason = block.reason ?? "blocked"
        const backoffAt = iso(Date.now() + limiter.backoffDelayMs(job.attempts))
        await markJobStatus(pool, job.id, "blocked", reason, backoffAt)
        await markSourceBlocked(pool, reason)
        throw new SourceBlockedError(reason)
      }

      if (page.status < 200 || page.status >= 300) {
        await markJobStatus(pool, job.id, "failed", `http_${page.status}`, nextRunAt)
        continue
      }

      const parsed = parseGlassdoorCompanyCandidates({
        html: page.html,
        sourceUrl: targetUrl,
        sectorKeyword: job.sector_keyword,
        locationKeyword: job.location_keyword,
      })
      companiesFound += parsed.length

      for (const candidate of parsed) {
        const normalized = normalizeCompanyName(candidate.companyNameRaw)
        if (!normalized) continue
        const result = await insertDiscoveredCandidate(pool, candidate)
        if (result.inserted) candidatesInserted += 1
        else duplicatesSkipped += 1

        if (!result.enqueuedCompanyId) {
          const enqueued = await enqueueCandidateIntoResolver(pool, result.id, candidate)
          if (enqueued) resolverEnqueued += 1
        }
      }

      await markJobStatus(pool, job.id, "completed", null, nextRunAt)
    }
  } catch (error) {
    if (error instanceof SourceBlockedError) {
      status = "blocked"
      errorMessage = error.message
    } else if (error instanceof RequestBudgetExceededError) {
      status = "budget_exhausted"
      errorMessage = error.message
    } else {
      status = "failed"
      errorMessage = error instanceof Error ? error.message : String(error)
    }
  } finally {
    const unprocessed = claimedJobs
      .filter((job) => !processedJobIds.has(job.id))
      .map((job) => job.id)
    await releaseUnprocessedJobs(pool, unprocessed).catch(() => undefined)
    await finishRunLog(pool, logId, {
      status,
      requestsAttempted,
      requestsSkippedByRobots,
      companiesFound,
      duplicatesSkipped,
      errorMessage,
    }).catch(() => undefined)
    await releaseWorkerLock(lockClient).catch(() => undefined)
  }

  return {
    ok: status !== "failed" && status !== "blocked",
    status,
    jobsEnqueued,
    jobsClaimed,
    requestsAttempted,
    requestsSkippedByRobots,
    companiesFound,
    candidatesInserted,
    resolverEnqueued,
    duplicatesSkipped,
    errorMessage,
  }
}
