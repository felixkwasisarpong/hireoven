import { NextRequest, NextResponse } from "next/server"
import { crawlCareersPage, type CrawlTarget } from "@/lib/crawler"
import { requireCronAuth } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

// Vercel cron fires GET requests
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
      return crawlCareersPage(target)
    })
  )

  const succeeded = results.filter((r) => r.status === "fulfilled").length
  const failed = results.filter((r) => r.status === "rejected").length

  return NextResponse.json({
    success: true,
    companiesCrawled: companies?.length ?? 0,
    succeeded,
    failed,
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
