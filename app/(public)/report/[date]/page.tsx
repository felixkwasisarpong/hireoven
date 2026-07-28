import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import DailyReportView from "@/components/grow/DailyReportView"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { getStoredReport, listReportDates, toReportDate, type DailyReport } from "@/lib/grow/daily-report"
import { siteBaseUrl } from "@/lib/seo/site-url"

// Individual days are immutable once captured — cache aggressively (ISR daily).
export const revalidate = 86400

const BASE = siteBaseUrl()
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false
  const d = new Date(`${date}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date
}

async function load(date: string): Promise<{
  report: DailyReport | null
  prevDate: string | null
  nextDate: string | null
}> {
  if (!hasPostgresEnv()) return { report: null, prevDate: null, nextDate: null }
  const pool = getPostgresPool()
  const [report, dates] = await Promise.all([
    getStoredReport(pool, date),
    listReportDates(pool, 400),
  ])
  const idx = dates.indexOf(date)
  // dates are newest-first: the "previous" (older) day is at idx+1.
  const prevDate = idx >= 0 && idx + 1 < dates.length ? dates[idx + 1] : null
  const nextDate = idx > 0 ? dates[idx - 1] : null
  return { report, prevDate, nextDate }
}

export async function generateMetadata({
  params,
}: {
  params: { date: string }
}): Promise<Metadata> {
  const date = params.date
  if (!isValidDate(date)) return { title: "Fresh Jobs Report — Hireoven" }

  const pretty = new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
  const report = hasPostgresEnv() ? await getStoredReport(getPostgresPool(), date) : null
  const description = report
    ? `${report.totals.newJobs.toLocaleString("en-US")} fresh jobs, ${report.totals.aiJobs.toLocaleString("en-US")} AI roles, and ${report.totals.sponsorCompanies.toLocaleString("en-US")} companies with H-1B sponsorship history — discovered straight from company career pages on ${pretty}.`
    : `The jobs Hireoven discovered directly from company career pages on ${pretty}.`
  const ogImage = `${BASE}/api/og/daily-report?date=${date}`

  return {
    title: `Fresh Jobs Report — ${pretty} | Hireoven`,
    description,
    alternates: { canonical: `${BASE}/report/${date}` },
    openGraph: {
      title: `Fresh Jobs Report — ${pretty}`,
      description,
      type: "article",
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title: `Fresh Jobs Report — ${pretty}`, description, images: [ogImage] },
  }
}

export default async function DailyReportDatePage({ params }: { params: { date: string } }) {
  const date = params.date
  if (!isValidDate(date)) notFound()

  const { report, prevDate, nextDate } = await load(toReportDate(date))

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      {report ? (
        <DailyReportView report={report} prevDate={prevDate} nextDate={nextDate} />
      ) : (
        <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center sm:px-6">
          <p className="term-label">{"// fresh_jobs_report"}</p>
          <h1 className="mt-3 text-[1.9rem] font-semibold tracking-tight text-white">No report for this day</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[#ccd6cf]/70">
            We don&apos;t have a Fresh Jobs Report captured for {date}.
          </p>
          <Link href="/report" className="term-btn term-btn-amber mt-6">
            See the latest report
          </Link>
        </main>
      )}
    </div>
  )
}
