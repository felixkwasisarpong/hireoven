import crypto from "crypto"
import pLimit from "p-limit"
import { NextRequest, NextResponse } from "next/server"
import { crawlCareersPage, type CrawlTarget } from "@/lib/crawler"
import {
  applyCrawlQueuePolicy,
  defaultCrawlPolicyOptions,
  loadRecentCrawlSignals,
} from "@/lib/crawler/scheduling"
import { persistCrawlJobs } from "@/lib/crawler/persist"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  harvesterFlagEnabled,
  runAtsHarvest,
  type AtsHarvestCompany,
} from "@/lib/harvester/run-harvest"

const MAX_COMPANY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_COMPANY_MAX_ATTEMPTS ?? "2", 10)
)
const MAX_COMPANIES_PER_RUN = Math.max(
  10,
  Number.parseInt(process.env.CRAWLER_MAX_COMPANIES_PER_RUN ?? "150", 10)
)
const COMPANY_RETRY_BASE_DELAY_MS = Math.max(
  250,
  Number.parseInt(process.env.CRAWLER_COMPANY_RETRY_BASE_DELAY_MS ?? "600", 10)
)
const MAX_ERROR_MESSAGE_LENGTH = 800
const CRAWLER_COMPANY_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_COMPANY_CONCURRENCY ?? "4", 10)
)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toErrorMessage(error: unknown) {
  if (typeof error === "string") return error
  if (error instanceof Error) {
    if (error.message?.trim()) return error.message
    return error.name || "Unknown crawler error"
  }

  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>
    const pieces = [
      candidate.message,
      candidate.error,
      candidate.details,
      candidate.hint,
      candidate.code,
      candidate.status,
    ]
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value).trim())
      .filter(Boolean)

    if (pieces.length > 0) return pieces.join(" | ")

    try {
      const serialized = JSON.stringify(candidate)
      if (serialized && serialized !== "{}") return serialized
    } catch {}
  }

  return "Unknown crawler error"
}

function sanitizeErrorMessage(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return "Unknown crawler error"

  const titleMatch = trimmed.match(/<title>\s*([^<]+)\s*<\/title>/i)
  if (titleMatch?.[1]) {
    return titleMatch[1].replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
  }

  const compact = trimmed.replace(/\s+/g, " ")
  if (/<!doctype html|<html/i.test(trimmed)) {
    const textOnly = compact.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (textOnly) return textOnly.slice(0, MAX_ERROR_MESSAGE_LENGTH)
  }

  return compact.slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

function isTransientCrawlerError(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("bad gateway") ||
    lower.includes("gateway timeout") ||
    lower.includes("service unavailable") ||
    lower.includes("cloudflare") ||
    lower.includes("fetch failed") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("connection reset") ||
    lower.includes("econnreset") ||
    lower.includes("eai_again") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit")
  )
}

function crawlLogStatusFromResult(result: Awaited<ReturnType<typeof crawlCareersPage>>) {
  if (result.jobs.length > 0) return "success"
  if (result.outcomeStatus === "blocked") return "blocked"
  if (result.outcomeStatus === "fetch_error") return "fetch_error"
  if (result.outcomeStatus === "bad_url") return "bad_url"
  return "unchanged"
}

function isFailureLikeStatus(status: string) {
  return status === "failed" || status === "blocked" || status === "bad_url" || status === "fetch_error"
}

async function upsertCrawlRuntime(value: Record<string, unknown>) {
  const pool = getPostgresPool()
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    ["crawl_runtime", JSON.stringify(value)]
  )
}

async function insertCrawlLogSafe(prefix: string, params: {
  companyId: string
  status: string
  jobsFound: number
  newJobs: number
  durationMs: number
  crawledAtIso: string
  errorMessage: string | null
}) {
  const pool = getPostgresPool()
  try {
    await pool.query(
      `INSERT INTO crawl_logs (company_id, status, jobs_found, new_jobs, duration_ms, crawled_at, error_message)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz, $7)`,
      [
        params.companyId,
        params.status,
        params.jobsFound,
        params.newJobs,
        params.durationMs,
        params.crawledAtIso,
        params.errorMessage,
      ]
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${prefix} Unable to insert crawl log for ${params.companyId}: ${message}`)
  }
}

// Scheduled jobs (Coolify, cron, etc.) call GET with CRON_SECRET
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const runId = crypto.randomUUID()
  const startedAtIso = new Date().toISOString()
  const fullCrawlStartedAt = Date.now()
  const pool = getPostgresPool()
  let companiesCount = 0
  let companiesConsidered = 0
  let companiesSkipped = 0
  let queuePolicySummary: {
    selectedLaneCounts: Record<string, number>
    skippedLaneCounts: Record<string, number>
    skippedCooldown: number
    skippedLaneExcluded: number
  } | null = null
  let succeeded = 0
  let failed = 0
  let inserted = 0
  let totalDurationMs = 0
  let completed = false
  let lastErrorMessage: string | null = null

  await upsertCrawlRuntime({
    state: "running",
    runId,
    startedAt: startedAtIso,
    route: "api/crawl",
    trigger: "cron",
  })

  try {
    let companiesRaw: Array<{
      id: string
      name: string
      careers_url: string
      last_crawled_at: string | null
      ats_type: string | null
      ats_identifier: string | null
      job_count: number | null
      domain: string | null
      raw_ats_config: Record<string, unknown> | null
      etag: string | null
      last_modified: string | null
      freshness_tier: string | null
    }> = []
    try {
      const companyResult = await pool.query<{
        id: string
        name: string
        careers_url: string
        last_crawled_at: string | null
        ats_type: string | null
        ats_identifier: string | null
        job_count: number | null
        domain: string | null
        raw_ats_config: Record<string, unknown> | null
        etag: string | null
        last_modified: string | null
        freshness_tier: string | null
      }>(
        `SELECT id, name, careers_url, last_crawled_at, ats_type, ats_identifier, job_count,
                domain, raw_ats_config, etag, last_modified, freshness_tier
         FROM companies
         WHERE is_active = true
         ORDER BY last_crawled_at ASC NULLS FIRST`
      )
      companiesRaw = companyResult.rows
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "Database query failed"
      return NextResponse.json({ error: lastErrorMessage }, { status: 500 })
    }

    companiesConsidered = companiesRaw.length
    const signalMap = await loadRecentCrawlSignals(
      pool,
      companiesRaw.map((company) => company.id),
      6
    )
    const policy = applyCrawlQueuePolicy(
      companiesRaw,
      signalMap,
      defaultCrawlPolicyOptions()
    )
    const companies = policy.selected.slice(0, MAX_COMPANIES_PER_RUN)
    companiesCount = companies.length
    companiesSkipped = policy.skipped.length + (policy.selected.length - companies.length)
    queuePolicySummary = {
      selectedLaneCounts: policy.selectedLaneCounts,
      skippedLaneCounts: policy.skippedLaneCounts,
      skippedCooldown: policy.skipped.filter((entry) => entry.reason === "cooldown_active").length,
      skippedLaneExcluded: policy.skipped.filter((entry) => entry.reason === "lane_excluded").length,
    }

    const limitCompany = pLimit(CRAWLER_COMPANY_CONCURRENCY)
    const useNewHarvester = harvesterFlagEnabled()
    const results = await Promise.all(
      companies.map((company) => limitCompany(async () => {
        const companyStartedAt = Date.now()

        if (useNewHarvester) {
          const harvestCompany: AtsHarvestCompany = {
            id: company.id,
            name: company.name,
            careers_url: company.careers_url,
            domain: company.domain,
            ats_type: company.ats_type,
            raw_ats_config: company.raw_ats_config,
            etag: company.etag,
            last_modified: company.last_modified,
            freshness_tier: company.freshness_tier,
          }
          const outcome = await runAtsHarvest({ pool, company: harvestCompany })
          if (outcome.matched) {
            void insertCrawlLogSafe(`[crawl:new-${outcome.adapter}]`, {
              companyId: company.id,
              status: outcome.status,
              jobsFound: outcome.jobsFound,
              newJobs: outcome.newJobs,
              durationMs: outcome.durationMs,
              crawledAtIso: outcome.crawledAtIso,
              errorMessage: outcome.notModified
                ? `not_modified (upstream ${outcome.upstreamLatencyMs}ms)`
                : outcome.errorMessage,
            })
            return {
              status: outcome.status === "failed" ? ("rejected" as const) : ("fulfilled" as const),
              crawlStatus: outcome.status,
              companyId: company.id,
              jobsFound: outcome.jobsFound,
              newJobs: outcome.newJobs,
              durationMs: outcome.durationMs,
              ...(outcome.errorMessage ? { error: outcome.errorMessage } : {}),
            }
          }
          // adapter didn't match this company — fall through to legacy crawl path
        }

        const target: CrawlTarget = {
          id: company.id,
          companyName: company.name,
          careersUrl: company.careers_url,
          lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
          atsType: company.ats_type,
          atsIdentifier: company.ats_identifier ?? null,
        }

        try {
          let crawlResult: Awaited<ReturnType<typeof crawlCareersPage>> | null = null
          let persistResult:
            | Awaited<
                ReturnType<typeof persistCrawlJobs>
              >
            | null = null
          let lastErrorMessage = ""
          let attempts = 0

          for (let attempt = 1; attempt <= MAX_COMPANY_ATTEMPTS; attempt += 1) {
            attempts = attempt
            try {
              crawlResult = await crawlCareersPage(target)
              persistResult = await persistCrawlJobs({
                companyId: company.id,
                companyMeta: {
                  name: company.name,
                  domain: company.domain,
                  careers_url: company.careers_url,
                  ats_type: company.ats_type,
                  raw_ats_config: company.raw_ats_config,
                },
                crawledAt: crawlResult.crawledAt,
                jobs: crawlResult.jobs,
                sourceUrl: crawlResult.url,
                normalizedUrl: crawlResult.normalizedUrl,
                resolvedCareersUrl: crawlResult.resolvedCareersUrl,
                diagnostics: crawlResult.diagnostics,
              })
              break
            } catch (error) {
              const message = sanitizeErrorMessage(toErrorMessage(error))
              lastErrorMessage = message
              if (!isTransientCrawlerError(message) || attempt >= MAX_COMPANY_ATTEMPTS) {
                throw new Error(message)
              }
              await sleep(COMPANY_RETRY_BASE_DELAY_MS * attempt)
            }
          }

          if (!crawlResult || !persistResult) {
            throw new Error(lastErrorMessage || "Company crawl failed")
          }

          const durationMs = Date.now() - companyStartedAt
          const status = crawlLogStatusFromResult(crawlResult)
          const outcomeMessage =
            status === "success" || status === "unchanged"
              ? null
              : crawlResult.outcomeReason ?? status
          void insertCrawlLogSafe("[crawl]", {
            companyId: company.id,
            status,
            jobsFound: crawlResult.jobs.length,
            newJobs: persistResult.inserted,
            durationMs,
            crawledAtIso: crawlResult.crawledAt.toISOString(),
            errorMessage:
              attempts > 1
                ? `Recovered after ${attempts} attempts${outcomeMessage ? ` | ${outcomeMessage}` : ""}`
                : outcomeMessage,
          })

          return {
            status: "fulfilled" as const,
            crawlStatus: status,
            companyId: company.id,
            jobsFound: crawlResult.jobs.length,
            newJobs: persistResult.inserted,
            durationMs,
          }
        } catch (crawlError) {
          const durationMs = Date.now() - companyStartedAt
          const errorMessage = sanitizeErrorMessage(toErrorMessage(crawlError))
          void insertCrawlLogSafe("[crawl]", {
            companyId: company.id,
            status: "failed",
            jobsFound: 0,
            newJobs: 0,
            durationMs,
            crawledAtIso: new Date().toISOString(),
            errorMessage,
          })

          return {
            status: "rejected" as const,
            crawlStatus: "failed" as const,
            companyId: company.id,
            jobsFound: 0,
            newJobs: 0,
            durationMs,
            error: errorMessage,
          }
        }
      }))
    )

    succeeded = results.filter((r) => !isFailureLikeStatus(r.crawlStatus)).length
    failed = results.filter((r) => isFailureLikeStatus(r.crawlStatus)).length
    inserted = results.reduce((sum, r) => sum + (r.newJobs ?? 0), 0)
    totalDurationMs = Date.now() - fullCrawlStartedAt
    const avgCompanyDurationMs =
      results.length > 0
        ? Math.round(
            results.reduce((sum, result) => sum + result.durationMs, 0) / results.length
          )
        : 0

    completed = true
    return NextResponse.json({
      success: true,
      companiesConsidered,
      companiesCrawled: companiesCount,
      companiesSkipped,
      succeeded,
      failed,
      inserted,
      queuePolicy: queuePolicySummary,
      totalDurationMs,
      avgCompanyDurationMs,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    lastErrorMessage = (error as Error).message
    return NextResponse.json({ error: lastErrorMessage }, { status: 500 })
  } finally {
    const finishedAtIso = new Date().toISOString()
    const duration = Date.now() - fullCrawlStartedAt
    await upsertCrawlRuntime({
      state: "idle",
      runId,
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      route: "api/crawl",
      trigger: "cron",
      companiesCrawled: companiesCount,
      companiesConsidered,
      companiesSkipped,
      succeeded,
      failed,
      inserted,
      totalDurationMs: completed ? totalDurationMs : duration,
      lastError: lastErrorMessage,
    })
  }
}

// POST: crawl a single company (admin manual trigger)
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!requireCronAuth(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json()) as {
    companyId: string
    careersUrl: string
    companyName: string
    atsType?: string | null
    atsIdentifier?: string | null
    lastCrawledAt?: string | null
  }

  const target: CrawlTarget = {
    id: body.companyId,
    companyName: body.companyName,
    careersUrl: body.careersUrl,
    lastCrawledAt: body.lastCrawledAt ? new Date(body.lastCrawledAt) : null,
    atsType: body.atsType ?? null,
    atsIdentifier: body.atsIdentifier ?? null,
  }

  const startedAt = Date.now()
  const result = await crawlCareersPage(target)
  const durationMs = Date.now() - startedAt
  return NextResponse.json({
    success: true,
    jobsFound: result.jobs.length,
    durationMs,
  })
}
