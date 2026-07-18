import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { getLatestReport, getStoredReport, toReportDate } from "@/lib/grow/daily-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Public read of the Fresh Jobs Report snapshot, for embedding / sharing.
//   GET /api/grow/daily-report            -> latest stored report
//   GET /api/grow/daily-report?date=YYYY-MM-DD -> a specific UTC day
//
// Read-only and cheap (single indexed row read), so it is CDN-cacheable for a
// few minutes.

export async function GET(request: NextRequest) {
  if (!hasPostgresEnv()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 })
  }

  const pool = getPostgresPool()
  const dateParam = request.nextUrl.searchParams.get("date")

  try {
    const report = dateParam
      ? await getStoredReport(pool, toReportDate(dateParam))
      : await getLatestReport(pool)

    if (!report) {
      return NextResponse.json({ error: "No report available yet" }, { status: 404 })
    }

    return NextResponse.json(report, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
