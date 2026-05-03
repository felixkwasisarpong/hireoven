import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { scanStaleGhostJobs } from "@/lib/jobs/ghost-scan-worker"

export const runtime = "nodejs"
export const maxDuration = 300 // 5 minutes — worker processes up to 50 jobs

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await scanStaleGhostJobs()
    return NextResponse.json({
      ok: true,
      processed: result.processed,
      failed: result.failed,
      durationMs: result.durationMs,
      message: `Ghost scan complete: ${result.processed} scored, ${result.failed} failed in ${result.durationMs}ms`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
