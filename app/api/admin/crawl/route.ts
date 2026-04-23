import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { crawlCareersPage, type CrawlTarget } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Company } from "@/types"

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

type CrawlAction =
  | { type: "all" }
  | { type: "failed" }
  | { type: "company"; id: string }

type CrawlLogSummary = {
  company_id: string | null
  status: string | null
  crawled_at: string | null
}

async function getTargetCompanies(action: CrawlAction) {
  const supabase = createAdminClient()

  if (action.type === "company") {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", action.id)
      .single()

    if (error) throw error
    return [data] as Company[]
  }

  const { data: companies, error } = await supabase
    .from("companies")
    .select("*")
    .eq("is_active", true)

  if (error) throw error

  if (action.type === "all") {
    return (companies ?? []) as Company[]
  }

  const { data: logs, error: logsError } = await supabase
    .from("crawl_logs")
    .select("company_id, status, crawled_at")
    .order("crawled_at", { ascending: false })

  if (logsError) throw logsError

  const latestByCompany = new Map<string, string | null>()
  for (const log of ((logs ?? []) as CrawlLogSummary[])) {
    if (!log.company_id || latestByCompany.has(log.company_id)) continue
    latestByCompany.set(log.company_id, log.status)
  }

  return ((companies ?? []) as Company[]).filter(
    (company) => latestByCompany.get(company.id) === "failed"
  )
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
  const supabase = createAdminClient()
  const runStartedAt = Date.now()
  let completed = false
  let companiesCount = 0
  let succeeded = 0
  let failed = 0
  let inserted = 0
  let lastError: string | null = null

  await ((supabase.from("system_settings") as any).upsert({
    key: "crawl_runtime",
    value: {
      state: "running",
      runId,
      startedAt: startedAtIso,
      route: "api/admin/crawl",
      trigger: `admin:${action.type}`,
    },
  } as any))

  try {
    const companies = await getTargetCompanies(action)
    companiesCount = companies.length
    const results: Array<{
      companyId: string
      companyName: string
      status: "success" | "failed" | "unchanged"
      newJobs: number
      durationMs: number
      error?: string
    }> = []

    for (const company of companies) {
      const startedAt = Date.now()
      const target: CrawlTarget = {
        id: company.id,
        companyName: company.name,
        careersUrl: company.careers_url,
        lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
        atsType: company.ats_type ?? null,
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
        const status = result.jobs.length > 0 ? "success" : "unchanged"

        const { error: crawlLogInsertError } = await ((supabase.from("crawl_logs") as any).insert({
          company_id: company.id,
          status,
          jobs_found: result.jobs.length,
          new_jobs: persistResult.inserted,
          duration_ms: durationMs,
          crawled_at: result.crawledAt.toISOString(),
          error_message: attempts > 1 ? `Recovered after ${attempts} attempts` : null,
        }))
        if (crawlLogInsertError) {
          console.error(
            `[admin/crawl] Unable to insert crawl log for ${company.id}: ${crawlLogInsertError.message}`
          )
        }

        results.push({
          companyId: company.id,
          companyName: company.name,
          status,
          newJobs: persistResult.inserted,
          durationMs,
        })
      } catch (error) {
        const durationMs = Date.now() - startedAt
        const errorMessage = sanitizeErrorMessage(toErrorMessage(error))
        const { error: crawlLogInsertError } = await ((supabase.from("crawl_logs") as any).insert({
          company_id: company.id,
          status: "failed",
          jobs_found: 0,
          new_jobs: 0,
          duration_ms: durationMs,
          error_message: errorMessage,
          crawled_at: new Date().toISOString(),
        }))
        if (crawlLogInsertError) {
          console.error(
            `[admin/crawl] Unable to insert failed crawl log for ${company.id}: ${crawlLogInsertError.message}`
          )
        }

        results.push({
          companyId: company.id,
          companyName: company.name,
          status: "failed",
          newJobs: 0,
          durationMs,
          error: errorMessage,
        })
      }
    }

    succeeded = results.filter((result) => result.status !== "failed").length
    failed = results.filter((result) => result.status === "failed").length
    inserted = results.reduce((sum, result) => sum + result.newJobs, 0)
    completed = true

    return NextResponse.json({
      success: true,
      count: results.length,
      results,
      totalDurationMs: Date.now() - runStartedAt,
    })
  } catch (error) {
    lastError = (error as Error).message
    return NextResponse.json(
      { error: lastError },
      { status: 500 }
    )
  } finally {
    await ((supabase.from("system_settings") as any).upsert({
      key: "crawl_runtime",
      value: {
        state: "idle",
        runId,
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
        route: "api/admin/crawl",
        trigger: `admin:${action.type}`,
        companiesCrawled: companiesCount,
        succeeded,
        failed,
        inserted,
        totalDurationMs: Date.now() - runStartedAt,
        lastError: lastError,
        completed,
      },
    } as any))
  }
}
