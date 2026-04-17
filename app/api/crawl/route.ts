import { NextRequest, NextResponse } from "next/server"
import { crawlCareersPage, type CrawlTarget } from "@/lib/crawler"

export async function POST(request: NextRequest) {
  // TODO: authenticate request (cron secret or service role)
  const body = (await request.json()) as { companyId: string; careersUrl: string; companyName: string }

  const target: CrawlTarget = {
    id: body.companyId,
    companyName: body.companyName,
    careersUrl: body.careersUrl,
    lastCrawledAt: null,
  }

  const result = await crawlCareersPage(target)
  return NextResponse.json({ success: true, jobsFound: result.jobs.length })
}
