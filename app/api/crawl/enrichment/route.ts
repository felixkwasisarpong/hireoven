import { NextRequest, NextResponse } from "next/server"
import { processPendingCrawlerEnrichmentBatch } from "@/lib/crawler/enrichment"
import { isAiBudgetExceeded, getTodaysAiSpendUsd, getDailyAiBudgetCapUsd } from "@/lib/scout/budget/cap"
import { requireCronAuth } from "@/lib/env"

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Skip the whole batch if today's AI spend has already hit the cap. The
  // batch can otherwise add $1+ on a single run; the cap is a hard kill
  // switch that protects against runaway cost.
  if (await isAiBudgetExceeded()) {
    return NextResponse.json({
      success: false,
      skipped: "ai_budget_exceeded",
      todaySpendUsd: await getTodaysAiSpendUsd(),
      capUsd: getDailyAiBudgetCapUsd(),
      processedAt: new Date().toISOString(),
    }, { status: 503 })
  }

  const result = await processPendingCrawlerEnrichmentBatch()
  return NextResponse.json({ success: true, ...result, processedAt: new Date().toISOString() })
}
