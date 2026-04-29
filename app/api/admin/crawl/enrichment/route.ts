import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { processPendingCrawlerEnrichmentBatch } from "@/lib/crawler/enrichment"

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => ({}))) as {
    batchSize?: number
    concurrency?: number
    maxAttempts?: number
  }

  const result = await processPendingCrawlerEnrichmentBatch({
    batchSize: body.batchSize,
    concurrency: body.concurrency,
    maxAttempts: body.maxAttempts,
  })

  return NextResponse.json({ success: true, ...result, processedAt: new Date().toISOString() })
}
