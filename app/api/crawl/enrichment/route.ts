import { NextRequest, NextResponse } from "next/server"
import { processPendingCrawlerEnrichmentBatch } from "@/lib/crawler/enrichment"
import { requireCronAuth } from "@/lib/env"

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await processPendingCrawlerEnrichmentBatch()
  return NextResponse.json({ success: true, ...result, processedAt: new Date().toISOString() })
}
