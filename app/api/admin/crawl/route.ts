import crypto from "crypto"
import pLimit from "p-limit"
import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { sendCrawlTopMatchDigests, type CrawlTopMatchDigestSummary } from "@/lib/alerts/crawl-match-digest"
import { crawlCareersPage, type CrawlTarget } from "@/lib/crawler"
import {
  applyCrawlQueuePolicy,
  defaultCrawlPolicyOptions,
  loadRecentCrawlSignals,
} from "@/lib/crawler/scheduling"
import { persistCrawlJobs } from "@/lib/crawler/persist"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Company } from "@/types"

const MAX_COMPANY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_COMPANY_MAX_ATTEMPTS ?? "2", 10)
)
const COMPANY_RETRY_BASE_DELAY_MS = Math.max(
  250,
  Number.parseInt(process.env.CRAWLER_COMPANY_RETRY_BASE_DELAY_MS ?? "1200", 10)
)
const CRAWLER_COMPANY_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_COMPANY_CONCURRENCY ?? "4", 10)
)
const MAX_ERROR_MESSAGE_LENGTH = 800

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

type CrawlAction =
  | { type: "all" }
  | { type: "failed" }
  | { type: "company"; id: string }

async function getTargetCompanies(action: CrawlAction): Promise<Company[]> {
  const pool = getPostgresPool()

  if (action.type === "company") {
    const { rows } = await pool.query<Company>(`SELECT * FROM companies WHERE id = $1`, [
      action.id,
    ])
    if (rows.length !== 1) throw new Error("Company not found")
    return rows
  }

  if (action.type === "all") {
    const { rows } = await pool.query<Company>(
      `SELECT * FROM companies WHERE is_active = true`
    )
    return rows
  }

  const { rows } = await pool.query<Company>(
    `WITH latest AS (
       SELECT DISTINCT ON (company_id) company_id, status
       FROM crawl_logs
       WHERE company_id IS NOT NULL
       ORDER BY company_id, crawled_at DESC NULLS LAST
     )
     SELECT c.*
     FROM companies c
     INNER JOIN latest l ON l.company_id = c.id
     WHERE c.is_active = true AND l.status IN ('failed', 'blocked', 'bad_url', 'fetch_error')`
  )
  return rows
}

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const runId = crypto.randomUUID()
  const startedAtIso = new Date().toISOString()
  const body = (await request.json()) as CrawlAction
  const action: CrawlAction = body?.type ? body : { type: "all" }
  const pool = getPostgresPool()
  const runStartedAt = Date.now()
  let completed = false
  let companiesConsidered = 0
  let companiesSkipped = 0
  let queuePolicySummary: {
    selectedLaneCounts: Record<string, number>
    skippedLaneCounts: Record<string, number>
    skippedCooldown: number
    skippedLaneExcluded: number
  } | null = null
  let companiesCount = 0
  let succeeded = 0
  let failed = 0
  let inserted = 0
  let lastError: string | null = null
  let topMatchDigest: CrawlTopMatchDigestSummary | null = null

  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [
      "crawl_runtime",
      JSON.stringify({
        state: "running",
        runId,
        startedAt: startedAtIso,
        route: "api/admin/crawl",
        trigger: `admin:${action.type}`,
      }),
    ]
  )

  try {
    const companiesRaw = await getTargetCompanies(action)
    companiesConsidered = companiesRaw.length
    const signalMap = await loadRecentCrawlSignals(
      pool,
      companiesRaw.map((company) => company.id),
      6
    )
    const policyOptions =
      action.type === "company"
        ? defaultCrawlPolicyOptions({
            bypassCooldown: true,
            includeBlocked: true,
            includeDomainBroken: true,
            includeLikelyInactive: true,
          })
        : action.type === "failed"
          ? defaultCrawlPolicyOptions({
              includeBlocked: true,
              includeDomainBroken: true,
              includeLikelyInactive: true,
            })
          : defaultCrawlPolicyOptions()
    const policy = applyCrawlQueuePolicy(companiesRaw, signalMap, policyOptions)
    const companies = policy.selected
    companiesCount = companies.length
    companiesSkipped = policy.skipped.length
    queuePolicySummary = {
      selectedLaneCounts: policy.selectedLaneCounts,
      skippedLaneCounts: policy.skippedLaneCounts,
      skippedCooldown: policy.skipped.filter((entry) => entry.reason === "cooldown_active").length,
      skippedLaneExcluded: policy.skipped.filter((entry) => entry.reason === "lane_excluded").length,
    }
    const limitCompany = pLimit(CRAWLER_COMPANY_CONCURRENCY)
    const results = await Promise.all(
      companies.map((company) => limitCompany(async () => {
        const startedAt = Date.now()
        const target: CrawlTarget = {
          id: company.id,
          companyName: company.name,
          careersUrl: company.careers_url,
          lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
          atsType: company.ats_type ?? null,
          atsIdentifier: company.ats_identifier ?? null,
        }

        try {
          let result: Awaited<ReturnType<typeof crawlCareersPage>> | null = null
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
              result = await crawlCareersPage(target)
              persistResult = await persistCrawlJobs({
                companyId: company.id,
                crawledAt: result.crawledAt,
                jobs: result.jobs,
                sourceUrl: result.url,
                normalizedUrl: result.normalizedUrl,
                diagnostics: result.diagnostics,
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

          if (!result || !persistResult) {
            throw new Error(lastErrorMessage || "Company crawl failed")
          }

          const durationMs = Date.now() - startedAt
          const status = crawlLogStatusFromResult(result)
          const outcomeMessage =
            status === "success" || status === "unchanged"
              ? null
              : result.outcomeReason ?? status

          try {
            await pool.query(
              `INSERT INTO crawl_logs (company_id, status, jobs_found, new_jobs, duration_ms, crawled_at, error_message)
               VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz, $7)`,
              [
                company.id,
                status,
                result.jobs.length,
                persistResult.inserted,
                durationMs,
                result.crawledAt.toISOString(),
                attempts > 1
                  ? `Recovered after ${attempts} attempts${outcomeMessage ? ` | ${outcomeMessage}` : ""}`
                  : outcomeMessage,
              ]
            )
          } catch (logError) {
            console.error(
              `[admin/crawl] Unable to insert crawl log for ${company.id}:`,
              logError instanceof Error ? logError.message : logError
            )
          }

          return {
            companyId: company.id,
            companyName: company.name,
            status,
            newJobs: persistResult.inserted,
            durationMs,
          }
        } catch (error) {
          const durationMs = Date.now() - startedAt
          const errorMessage = sanitizeErrorMessage(toErrorMessage(error))
          try {
            await pool.query(
              `INSERT INTO crawl_logs (company_id, status, jobs_found, new_jobs, duration_ms, crawled_at, error_message)
               VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz, $7)`,
              [
                company.id,
                "failed",
                0,
                0,
                durationMs,
                new Date().toISOString(),
                errorMessage,
              ]
            )
          } catch (logError) {
            console.error(
              `[admin/crawl] Unable to insert failed crawl log for ${company.id}:`,
              logError instanceof Error ? logError.message : logError
            )
          }

          return {
            companyId: company.id,
            companyName: company.name,
            status: "failed" as const,
            newJobs: 0,
            durationMs,
            error: errorMessage,
          }
        }
      }))
    )

    succeeded = results.filter((result) => !isFailureLikeStatus(result.status)).length
    failed = results.filter((result) => isFailureLikeStatus(result.status)).length
    inserted = results.reduce((sum, result) => sum + result.newJobs, 0)
    const digestWindowEndIso = new Date().toISOString()
    if (inserted > 0) {
      try {
        topMatchDigest = await sendCrawlTopMatchDigests({
          windowStartIso: startedAtIso,
          windowEndIso: digestWindowEndIso,
          minScore: 80,
          maxJobsPerUser: 5,
        })
      } catch (digestError) {
        const message = digestError instanceof Error ? digestError.message : String(digestError)
        console.error(`[admin/crawl] top-match digest failed: ${message}`)
      }
    } else {
      topMatchDigest = {
        enabled: Boolean(process.env.RESEND_API_KEY),
        windowStartIso: startedAtIso,
        windowEndIso: digestWindowEndIso,
        minScore: 80,
        maxJobsPerUser: 5,
        jobsInsertedInWindow: 0,
        matchedUsers: 0,
        emailsSent: 0,
        emailsFailed: 0,
        skippedReason: "No new jobs inserted in this crawl window",
      }
    }
    completed = true

    return NextResponse.json({
      success: true,
      companiesConsidered,
      companiesSkipped,
      count: results.length,
      results,
      queuePolicy: queuePolicySummary,
      topMatchDigest,
      totalDurationMs: Date.now() - runStartedAt,
    })
  } catch (error) {
    lastError = (error as Error).message
    return NextResponse.json(
      { error: lastError },
      { status: 500 }
    )
  } finally {
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [
        "crawl_runtime",
        JSON.stringify({
          state: "idle",
          runId,
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          route: "api/admin/crawl",
          trigger: `admin:${action.type}`,
          companiesCrawled: companiesCount,
          companiesConsidered,
          companiesSkipped,
          succeeded,
          failed,
          inserted,
          totalDurationMs: Date.now() - runStartedAt,
          lastError: lastError,
          completed,
        }),
      ]
    )
  }
}
