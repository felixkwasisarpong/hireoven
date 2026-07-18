import { ImageResponse } from "next/og"
import type { NextRequest } from "next/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { getLatestReport, getStoredReport, toReportDate, type DailyReport } from "@/lib/grow/daily-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const teal = "#1D9E75"
const bg = "#F8FAFC"

function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

// Shareable stat card for a day's Fresh Jobs Report. Read straight from the
// stored snapshot so screenshotting is instant.
//   GET /api/og/daily-report            -> latest
//   GET /api/og/daily-report?date=YYYY-MM-DD
export async function GET(request: NextRequest) {
  let report: DailyReport | null = null
  if (hasPostgresEnv()) {
    const pool = getPostgresPool()
    const dateParam = request.nextUrl.searchParams.get("date")
    report = dateParam
      ? await getStoredReport(pool, toReportDate(dateParam))
      : await getLatestReport(pool)
  }

  const t = report?.totals
  const stats: Array<{ value: number; label: string; color: string }> = [
    { value: t?.newJobs ?? 0, label: "fresh jobs", color: "#0f172a" },
    { value: t?.aiJobs ?? 0, label: "AI / ML roles", color: teal },
    { value: t?.sponsorCompanies ?? 0, label: "companies w/ sponsorship", color: "#7C3AED" },
    { value: t?.remoteJobs ?? 0, label: "remote roles", color: "#0D9488" },
  ]

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 56,
          background: `linear-gradient(145deg, ${bg} 0%, #ffffff 45%, #E8F7F2 100%)`,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1, color: "#0f172a" }}>
            Hireoven
          </div>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: -1.5, color: "#0f172a" }}>
            Fresh Jobs Report
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, color: teal }}>
            {report ? formatDate(report.date) : "Jobs served fresh, every morning"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 20 }}>
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                gap: 6,
                padding: "26px 22px",
                borderRadius: 20,
                background: "rgba(255,255,255,0.94)",
                border: "1px solid #e2e8f0",
                boxShadow: "0 10px 30px rgba(15,23,42,0.07)",
              }}
            >
              <div style={{ fontSize: 56, fontWeight: 800, color: s.color, letterSpacing: -2 }}>
                {s.value.toLocaleString("en-US")}
              </div>
              <div style={{ fontSize: 19, fontWeight: 600, color: "#64748b", lineHeight: 1.2 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 20, color: "#64748b" }}>
          Straight from company career pages · hireoven.com/report
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
