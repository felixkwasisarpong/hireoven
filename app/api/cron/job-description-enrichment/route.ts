import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { processPendingDescriptionEnrichmentBatch } from "@/lib/jobs/description-enrichment"

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const search = request.nextUrl.searchParams
  const batchSize = Number.parseInt(search.get("batch") ?? "", 10)
  const concurrency = Number.parseInt(search.get("concurrency") ?? "", 10)
  const maxAttempts = Number.parseInt(search.get("maxAttempts") ?? "", 10)
  const timeoutMs = Number.parseInt(search.get("timeoutMs") ?? "", 10)

  const result = await processPendingDescriptionEnrichmentBatch({
    batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
    concurrency: Number.isFinite(concurrency) ? concurrency : undefined,
    maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : undefined,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
  })

  return NextResponse.json({
    success: true,
    mode: "non_ai",
    ...result,
    processedAt: new Date().toISOString(),
  })
}
