import { NextRequest, NextResponse } from "next/server"
import { crawlCareersPage, type CrawlTarget } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"
import { requireCronAuth } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

// Scheduled jobs (Coolify, cron, etc.) call GET with CRON_SECRET
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, careers_url, last_crawled_at")
    .eq("is_active", true)
    .order("last_crawled_at", { ascending: true, nullsFirst: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = await Promise.allSettled(
    (companies ?? []).map(async (company) => {
      const target: CrawlTarget = {
        id: company.id,
        companyName: company.name,
        careersUrl: company.careers_url,
        lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
      }
      const crawlResult = await crawlCareersPage(target)
      const persistResult = await persistCrawlJobs({
        companyId: company.id,
        crawledAt: crawlResult.crawledAt,
        jobs: crawlResult.jobs,
      })

      const status = crawlResult.jobs.length > 0 ? "success" : "unchanged"
      await (supabase.from("crawl_logs") as any).insert({
        company_id: company.id,
        status,
        jobs_found: crawlResult.jobs.length,
        new_jobs: persistResult.inserted,
        duration_ms: null,
        crawled_at: crawlResult.crawledAt.toISOString(),
      })

      return {
        ...crawlResult,
        persisted: persistResult,
      }
    })
  )

  const succeeded = results.filter((r) => r.status === "fulfilled").length
  const failed = results.filter((r) => r.status === "rejected").length
  const inserted = results
    .filter((r): r is PromiseFulfilledResult<{ persisted: { inserted: number } }> => r.status === "fulfilled")
    .reduce((sum, r) => sum + (r.value.persisted?.inserted ?? 0), 0)

  return NextResponse.json({
    success: true,
    companiesCrawled: companies?.length ?? 0,
    succeeded,
    failed,
    inserted,
    timestamp: new Date().toISOString(),
  })
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
    lastCrawledAt?: string | null
  }

  const target: CrawlTarget = {
    id: body.companyId,
    companyName: body.companyName,
    careersUrl: body.careersUrl,
    lastCrawledAt: body.lastCrawledAt ? new Date(body.lastCrawledAt) : null,
  }

  const result = await crawlCareersPage(target)
  return NextResponse.json({ success: true, jobsFound: result.jobs.length })
}
