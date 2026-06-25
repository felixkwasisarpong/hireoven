import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import { getCompanyScorecard } from "@/lib/h1b/scorecard-query"
import { companyIdFromParam } from "@/lib/seo/company-seo"
import { ScorecardHero } from "@/components/h1b/scorecard/ScorecardHero"
import { ScorecardStats } from "@/components/h1b/scorecard/ScorecardStats"
import { ScorecardShare } from "@/components/h1b/scorecard/ScorecardShare"
import { ScorecardMethodologyNote } from "@/components/h1b/scorecard/ScorecardMethodologyNote"
import { getCompanyLayoffSignal } from "@/lib/h1b/layoff-signal-query"
import { LayoffSignalCard } from "@/components/h1b/layoffs/LayoffSignalCard"
import { getCompanyWageBreakdown } from "@/lib/salaries/wage-query"
import { getSocLabelMap } from "@/lib/salaries/soc-roles"
import { fmtUsd } from "@/components/salaries/SalaryCard"

export const revalidate = 86400

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

type Props = { params: Promise<{ company: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = companyIdFromParam((await params).company)
  if (!id) return {}
  const data = await getCompanyScorecard(id)
  if (!data) return {}

  const title = `${data.company.name} H-1B Scorecard: ${data.bucket.grade} (${data.score}/100)`
  const description = `${data.company.name} is a ${data.bucket.label.toLowerCase()}. ${data.metrics.certified_latest_fy.toLocaleString()} H-1B petitions certified in FY${data.metrics.latest_fy}. See the full methodology.`
  const ogImage = `${BASE}/api/og/scorecard/${data.company.id}`

  return {
    title,
    description,
    alternates: { canonical: data.scorecard_url },
    openGraph: {
      title,
      description,
      type: "article",
      url: `${BASE}${data.scorecard_url}`,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  }
}

export default async function ScorecardPage({ params }: Props) {
  const id = companyIdFromParam((await params).company)
  if (!id) notFound()
  const data = await getCompanyScorecard(id)
  if (!data) notFound()
  const layoffSignal = await getCompanyLayoffSignal(data.company.id)
  const wageBreakdown = await getCompanyWageBreakdown(data.company.id)
  const wageLabels = await getSocLabelMap(wageBreakdown.roles.map((r) => r.soc_group))

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${data.company.name} H-1B Sponsorability Scorecard`,
    image: `${BASE}/api/og/scorecard/${data.company.id}`,
    about: { "@type": "Organization", name: data.company.name },
    isAccessibleForFree: true,
    publisher: { "@type": "Organization", name: "Hireoven" },
    url: `${BASE}${data.scorecard_url}`,
  }

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <ScorecardHero data={data} />
        <ScorecardStats data={data} />
        {layoffSignal && (
          <div className="mt-8">
            <LayoffSignalCard signal={layoffSignal} />
          </div>
        )}

        {wageBreakdown.roles.length > 0 && (
          <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-slate-900">H-1B salaries</h3>
            <p className="mt-1 text-sm text-slate-500">Median prevailing wage by role (filed with the DOL).</p>
            <ul className="mt-3 space-y-2 text-sm">
              {wageBreakdown.roles.slice(0, 5).map((r) => {
                const lbl = wageLabels.get(r.soc_group)
                return (
                  <li key={r.soc_group} className="flex items-center justify-between">
                    {lbl ? (
                      <Link href={`/h1b-salaries/by-role/${lbl.slug}`} className="text-slate-700 hover:underline">
                        {lbl.label}
                      </Link>
                    ) : (
                      <span className="text-slate-700">{r.soc_group}</span>
                    )}
                    <span className="tabular-nums text-slate-900">
                      {fmtUsd(r.p50)} <span className="text-xs text-slate-400">n={r.n}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
            <Link href="/h1b-salaries" className="mt-3 inline-block text-sm font-medium text-slate-600 underline hover:text-slate-900">
              Explore H-1B salaries →
            </Link>
          </section>
        )}

        <ScorecardShare data={data} />

        <div className="mt-8 rounded-2xl border border-slate-200 bg-gradient-to-br from-[#0b2a23] to-[#0a2440] p-6 text-center">
          <p className="text-lg font-semibold text-white">
            How do <em>you</em> stack up at {data.company.name}?
          </p>
          <p className="mt-1 text-sm text-white/60">
            Get your own sponsorability scorecard in 60 seconds.
          </p>
          <Link
            href="/dashboard/scorecard"
            className="mt-4 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-bold text-slate-900 hover:bg-emerald-400 hover:text-white"
          >
            Get your scorecard →
          </Link>
        </div>

        <ScorecardMethodologyNote />
      </main>
    </div>
  )
}
