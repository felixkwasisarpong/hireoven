import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { generateAndStoreReport, toReportDate } from "@/lib/grow/daily-report"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"

// Schedule: nightly at 23:55 UTC so it captures the full UTC day before the day
// rolls over (harvester-box crontab — see scripts/crons.sh):
//   55 23 * * *   bash scripts/crons.sh daily-report
//
// Query params:
//   ?date=YYYY-MM-DD   generate a specific UTC day (backfill / re-run)
//
// Writes an idempotent snapshot to daily_job_reports; the public /report pages
// and the OG card read from there.

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const start = Date.now()
  const dateParam = request.nextUrl.searchParams.get("date")

  try {
    const day = dateParam ? toReportDate(dateParam) : undefined
    const report = await generateAndStoreReport(getPostgresPool(), day)
    return NextResponse.json({
      ok: true,
      date: report.date,
      totals: report.totals,
      top_companies: report.topCompanies.length,
      duration_ms: Date.now() - start,
    })
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
