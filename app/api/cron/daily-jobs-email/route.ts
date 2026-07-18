import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { sendDailyJobsDigest } from "@/lib/email/digests/daily-jobs"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

// Schedule: every morning at 12:00 UTC (~7–8am US Eastern), after the nightly
// daily-report run has captured the previous day (harvester-box crontab — see
// scripts/crons.sh):
//   0 12 * * *   bash scripts/crons.sh daily-jobs-email
//
// Query params:
//   ?date=YYYY-MM-DD   send for a specific UTC report day (backfill / re-run)
//
// Idempotent per (day, address): re-running the same day won't double-send.

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const start = Date.now()
  const date = request.nextUrl.searchParams.get("date") ?? undefined

  try {
    const result = await sendDailyJobsDigest(getPostgresPool(), { date })
    return NextResponse.json({ ok: true, ...result, duration_ms: Date.now() - start })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - start,
      },
      { status: 500 },
    )
  }
}
