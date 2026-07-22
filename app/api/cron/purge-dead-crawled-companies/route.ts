import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import {
  purgeDeadCrawledCompanies,
  purgeNeverLiveCompanies,
  type PurgeDeadMode,
} from "@/lib/companies/purge-dead-crawled"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const search = request.nextUrl.searchParams
  const minEmpty = Number.parseInt(search.get("minEmptyCrawls") ?? "", 10)
  const inactiveDays = Number.parseInt(search.get("inactiveDays") ?? "", 10)
  const minAgeDays = Number.parseInt(search.get("minAgeDays") ?? "", 10)
  const batch = Number.parseInt(search.get("batch") ?? "", 10)
  const maxBatches = Number.parseInt(search.get("maxBatches") ?? "", 10)
  const modeParam = search.get("mode")
  const mode: PurgeDeadMode | undefined = modeParam === "delete" || modeParam === "dead" ? modeParam : undefined
  const includeNeverLive = search.get("includeNeverLive") !== "false"

  const deadCrawled = await purgeDeadCrawledCompanies({
    mode,
    minEmptyCrawls: Number.isFinite(minEmpty) ? minEmpty : undefined,
    inactiveDays: Number.isFinite(inactiveDays) ? inactiveDays : undefined,
    batchSize: Number.isFinite(batch) ? batch : undefined,
    maxBatches: Number.isFinite(maxBatches) ? maxBatches : undefined,
  })

  const neverLive = includeNeverLive
    ? await purgeNeverLiveCompanies({
        mode,
        minEmptyCrawls: Number.isFinite(minEmpty) ? minEmpty : undefined,
        minAgeDays: Number.isFinite(minAgeDays) ? minAgeDays : undefined,
        batchSize: Number.isFinite(batch) ? batch : undefined,
        maxBatches: Number.isFinite(maxBatches) ? maxBatches : undefined,
      })
    : null

  return NextResponse.json({
    success: true,
    deadCrawled,
    neverLive,
    processedAt: new Date().toISOString(),
  })
}
