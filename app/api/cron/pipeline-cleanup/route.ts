import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { purgeStaleTerminalApplications } from "@/lib/applications/pipeline-cleanup"

export const runtime = "nodejs"
export const maxDuration = 60

// Schedule: daily at 2am UTC
// Deletes rejected/withdrawn applications older than 7 days

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const days = Number.parseInt(request.nextUrl.searchParams.get("days") ?? "", 10)

  const result = await purgeStaleTerminalApplications({
    olderThanDays: Number.isFinite(days) ? days : undefined,
  })

  return NextResponse.json({ ok: true, ...result, processedAt: new Date().toISOString() })
}
