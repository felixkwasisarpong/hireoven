import { NextRequest, NextResponse } from "next/server"
import { processPendingCrawlerEnrichmentBatch } from "@/lib/crawler/enrichment"
import { getCrawlerAiEnrichmentMode } from "@/lib/crawler/enrichment-mode"
import { isAiBudgetExceeded, getTodaysAiSpendUsd, getDailyAiBudgetCapUsd } from "@/lib/scout/budget/cap"
import { requireCronAuth } from "@/lib/env"

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // AI enrichment is opt-in. Default is "off" so the cron is a no-op
  // unless CRAWLER_AI_ENRICHMENT_MODE=async (or sync) is explicitly set.
  // This protects against accidental spend if the cron is scheduled but
  // the team isn't ready to fund Haiku calls.
  if (getCrawlerAiEnrichmentMode() === "off") {
    return NextResponse.json({
      success: true,
      skipped: "ai_enrichment_disabled",
      hint: "Set CRAWLER_AI_ENRICHMENT_MODE=async to enable.",
      processedAt: new Date().toISOString(),
    })
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
