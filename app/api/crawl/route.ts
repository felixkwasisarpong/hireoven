import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { crawlCareersPage, type CrawlTarget } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"

const MAX_COMPANY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_COMPANY_MAX_ATTEMPTS ?? "2", 10)
)
const COMPANY_RETRY_BASE_DELAY_MS = Math.max(
  250,
  Number.parseInt(process.env.CRAWLER_COMPANY_RETRY_BASE_DELAY_MS ?? "1200", 10)
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
    let companies: Array<{
      id: string
      name: string
      careers_url: string
      last_crawled_at: string | null
      ats_type: string | null
    }>
    try {
      const companyResult = await pool.query<{
        id: string
        name: string
        careers_url: string
        last_crawled_at: string | null
        ats_type: string | null
      }>(
        `SELECT id, name, careers_url, last_crawled_at, ats_type
         FROM companies
         WHERE is_active = true
         ORDER BY last_crawled_at ASC NULLS FIRST`
      )
      companies = companyResult.rows
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "Database query failed"
      return NextResponse.json({ error: lastErrorMessage }, { status: 500 })
    }

    companiesCount = companies.length

    const results = await Promise.all(
      companies.map(async (company) => {
        const companyStartedAt = Date.now()
        const target: CrawlTarget = {
          id: company.id,
          companyName: company.name,
          careersUrl: company.careers_url,
          lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
          atsType: company.ats_type,
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
                crawledAt: crawlResult.crawledAt,
                jobs: crawlResult.jobs,
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
          const status = crawlResult.jobs.length > 0 ? "success" : "unchanged"
          await insertCrawlLogSafe("[crawl]", {
            companyId: company.id,
            status,
            jobsFound: crawlResult.jobs.length,
            newJobs: persistResult.inserted,
            durationMs,
            crawledAtIso: crawlResult.crawledAt.toISOString(),
            errorMessage: attempts > 1 ? `Recovered after ${attempts} attempts` : null,
          })

          return {
            status: "fulfilled" as const,
            companyId: company.id,
            jobsFound: crawlResult.jobs.length,
            newJobs: persistResult.inserted,
            durationMs,
          }
        } catch (crawlError) {
          const durationMs = Date.now() - companyStartedAt
          const errorMessage = sanitizeErrorMessage(toErrorMessage(crawlError))
          await insertCrawlLogSafe("[crawl]", {
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
            companyId: company.id,
            jobsFound: 0,
            newJobs: 0,
            durationMs,
            error: errorMessage,
          }
        }
      })
    )

    succeeded = results.filter((r) => r.status === "fulfilled").length
    failed = results.filter((r) => r.status === "rejected").length
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
      companiesCrawled: companiesCount,
      succeeded,
      failed,
      inserted,
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
    lastCrawledAt?: string | null
  }

  const target: CrawlTarget = {
    id: body.companyId,
    companyName: body.companyName,
    careersUrl: body.careersUrl,
    lastCrawledAt: body.lastCrawledAt ? new Date(body.lastCrawledAt) : null,
    atsType: body.atsType ?? null,
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
