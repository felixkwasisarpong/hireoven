import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { purgeExpiredInactiveJobs } from "@/lib/jobs/retention"

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const search = request.nextUrl.searchParams
  const days = Number.parseInt(search.get("days") ?? "", 10)
  const batch = Number.parseInt(search.get("batch") ?? "", 10)
  const maxBatches = Number.parseInt(search.get("maxBatches") ?? "", 10)

  const result = await purgeExpiredInactiveJobs({
    olderThanDays: Number.isFinite(days) ? days : undefined,
    batchSize: Number.isFinite(batch) ? batch : undefined,
    maxBatches: Number.isFinite(maxBatches) ? maxBatches : undefined,
  })

  return NextResponse.json({
    success: true,
    ...result,
    processedAt: new Date().toISOString(),
  })
}
