import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import DailyReportView from "@/components/grow/DailyReportView"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { getLatestReport, listReportDates, type DailyReport } from "@/lib/grow/daily-report"

// The "latest" view changes daily — revalidate hourly so a fresh snapshot shows
// up promptly after the nightly cron without rebuilding on every request.
export const revalidate = 3600

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

export const metadata: Metadata = {
  title: "Fresh Jobs Report — jobs posted today | Hireoven",
  description:
    "A daily snapshot of the jobs Hireoven discovered straight from company career pages — AI roles, remote roles, new-grad roles, and companies with H-1B sponsorship history.",
  alternates: { canonical: `${BASE}/report` },
  openGraph: {
    title: "Fresh Jobs Report — jobs posted today",
    description: "The jobs discovered straight from company career pages, updated every day.",
    type: "website",
    images: [{ url: `${BASE}/api/og/daily-report`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Fresh Jobs Report — jobs posted today",
    description: "The jobs discovered straight from company career pages, updated every day.",
    images: [`${BASE}/api/og/daily-report`],
  },
}

async function load(): Promise<{ report: DailyReport | null; prevDate: string | null }> {
  if (!hasPostgresEnv()) return { report: null, prevDate: null }
  const pool = getPostgresPool()
  const [report, dates] = await Promise.all([getLatestReport(pool), listReportDates(pool, 2)])
  // dates[0] is the latest (this report); dates[1] is the previous day.
  const prevDate = dates.length > 1 ? dates[1] : null
  return { report, prevDate }
}

export default async function DailyReportLatestPage() {
  const { report, prevDate } = await load()

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      {report ? (
        <DailyReportView report={report} prevDate={prevDate} nextDate={null} />
      ) : (
        <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center sm:px-6">
          <p className="term-label">{"// fresh_jobs_report"}</p>
          <h1 className="mt-3 text-[1.9rem] font-semibold tracking-tight text-white">The first report is on its way</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[#ccd6cf]/70">
            Hireoven publishes a Fresh Jobs Report every day. Check back after the next overnight run.
          </p>
          <Link href="/jobs" className="term-btn term-btn-amber mt-6">
            Browse fresh jobs now
          </Link>
        </main>
      )}
    </div>
  )
}
