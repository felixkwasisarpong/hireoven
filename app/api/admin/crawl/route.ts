import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { crawlCareersPage, type CrawlTarget } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Company } from "@/types"

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

  const body = (await request.json()) as CrawlAction
  const action: CrawlAction = body?.type ? body : { type: "all" }
  const supabase = createAdminClient()

  try {
    const companies = await getTargetCompanies(action)
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
        const result = await crawlCareersPage(target)
        const durationMs = Date.now() - startedAt
        const status = result.jobs.length > 0 ? "success" : "unchanged"
        const persistResult = await persistCrawlJobs({
          companyId: company.id,
          crawledAt: result.crawledAt,
          jobs: result.jobs,
        })

        await (supabase.from("crawl_logs") as any).insert({
          company_id: company.id,
          status,
          jobs_found: result.jobs.length,
          new_jobs: persistResult.inserted,
          duration_ms: durationMs,
          crawled_at: result.crawledAt.toISOString(),
        })

        results.push({
          companyId: company.id,
          companyName: company.name,
          status,
          newJobs: persistResult.inserted,
          durationMs,
        })
      } catch (error) {
        const durationMs = Date.now() - startedAt
        await (supabase.from("crawl_logs") as any).insert({
          company_id: company.id,
          status: "failed",
          jobs_found: 0,
          new_jobs: 0,
          duration_ms: durationMs,
          error_message: (error as Error).message,
          crawled_at: new Date().toISOString(),
        })

        results.push({
          companyId: company.id,
          companyName: company.name,
          status: "failed",
          newJobs: 0,
          durationMs,
          error: (error as Error).message,
        })
      }
    }

    return NextResponse.json({
      success: true,
      count: results.length,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
