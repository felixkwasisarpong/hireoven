import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, Building2, ShieldCheck, Unlock } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { getCompanyScorecard } from "@/lib/h1b/scorecard-query"
import { scoreBucket } from "@/lib/h1b/scorecard"
import { companyIdFromParam } from "@/lib/seo/company-seo"
import { ConfidenceRing } from "@/components/h1b/scorecard/ConfidenceRing"
import { ScorecardShare } from "@/components/h1b/scorecard/ScorecardShare"
import { ScorecardMethodologyNote } from "@/components/h1b/scorecard/ScorecardMethodologyNote"
import { getCompanyLayoffSignal } from "@/lib/h1b/layoff-signal-query"
import { LayoffSignalCard } from "@/components/h1b/layoffs/LayoffSignalCard"
import { WatchButton } from "@/components/watch/WatchButton"
import { getCompanyWageBreakdown } from "@/lib/salaries/wage-query"
import { getSocLabelMap } from "@/lib/salaries/soc-roles"
import { fmtUsd } from "@/components/salaries/SalaryCard"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import type { ScoreHue } from "@/types/h1b-scorecard"

// Grade hues stay semantically distinct (A+ → F), dark-adapted surfaces.
const GRADE_PILL: Record<ScoreHue, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/12 text-emerald-300",
  green: "border-green-500/30 bg-green-500/12 text-green-300",
  lime: "border-lime-500/30 bg-lime-500/12 text-lime-300",
  amber: "border-amber-500/30 bg-amber-500/12 text-amber-300",
  orange: "border-orange-500/30 bg-orange-500/12 text-orange-300",
  red: "border-red-500/30 bg-red-500/12 text-red-300",
}

async function getPathways(companyId: string) {
  if (!hasPostgresEnv()) return null
  const { rows } = await getPostgresPool().query<{
    is_cap_exempt: boolean
    cap_exempt_reason: string | null
    is_e_verify: boolean
  }>(
    `SELECT is_cap_exempt, cap_exempt_reason, is_e_verify FROM companies WHERE id = $1 LIMIT 1`,
    [companyId]
  )
  return rows[0] ?? null
}

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
  const pathways = await getPathways(data.company.id)

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

  const m = data.metrics
  const bucket = scoreBucket(data.score)
  const stats: Array<{ label: string; value: string }> = [
    { label: "Total LCA filings", value: m.total_filings.toLocaleString() },
    {
      label: m.latest_fy > 0 ? `Certified · FY${m.latest_fy}` : "Certified",
      value: m.certified_latest_fy.toLocaleString(),
    },
    { label: "Certification rate", value: `${(m.cert_rate * 100).toFixed(1)}%` },
  ]
  if (data.rank.overall != null) {
    stats.push({ label: "National rank", value: `#${data.rank.overall.toLocaleString()}` })
  } else if (data.rank.in_industry != null && data.rank.industry) {
    stats.push({ label: `Rank · ${data.rank.industry}`, value: `#${data.rank.in_industry}` })
  }

  const series = m.series ?? []
  const maxApproved = series.reduce((mx, s) => Math.max(mx, s.approved), 0)

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-[13px] text-[#ccd6cf]/45">
          <Link href="/h1b-sponsors/leaderboard" className="hover:text-[#38e08a]">All sponsors</Link>
          <span className="text-[#ccd6cf]/25">/</span>
          <Link href={data.profile_url} className="hover:text-[#38e08a]">{data.company.name}</Link>
          <span className="text-[#ccd6cf]/25">/</span>
          <span className="text-[#ccd6cf]/70">Scorecard</span>
        </nav>

        {/* Hero */}
        <section className="term-panel p-6 sm:p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-stretch lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-4">
                <CompanyLogo
                  companyName={data.company.name}
                  domain={data.company.domain}
                  logoUrl={data.company.logo_url}
                  priority
                  className="h-20 w-20 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-1.5 sm:h-24 sm:w-24"
                />
                <div className="min-w-0">
                  <p className="truncate text-2xl font-semibold tracking-tight text-white">{data.company.name}</p>
                  {data.company.industry && (
                    <span className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-[#ccd6cf]/55">
                      <Building2 className="h-3.5 w-3.5 text-[#ccd6cf]/60" /> {data.company.industry}
                    </span>
                  )}
                </div>
              </div>

              <span className={`mt-5 inline-flex items-center gap-1.5 border px-3.5 py-1.5 text-sm font-semibold ${GRADE_PILL[bucket.hue]}`}>
                {bucket.grade} · {bucket.label}
              </span>

              <h1 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-white sm:text-[30px]">
                {data.company.name} H-1B <span className="text-[#f5a623]">sponsorability scorecard</span>
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#ccd6cf]/70">{bucket.description}</p>

              {pathways && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {pathways.is_cap_exempt && (
                    <span className="inline-flex items-center gap-1.5 border border-amber-500/30 bg-amber-500/12 px-3 py-1 text-xs font-semibold text-amber-300">
                      <Unlock className="h-3.5 w-3.5" /> Cap-exempt · files outside the lottery
                    </span>
                  )}
                  {pathways.is_e_verify && (
                    <span className="inline-flex items-center gap-1.5 border border-emerald-500/30 bg-emerald-500/12 px-3 py-1 text-xs font-semibold text-emerald-300">
                      <ShieldCheck className="h-3.5 w-3.5" /> E-Verify · STEM OPT eligible
                    </span>
                  )}
                  {!pathways.is_cap_exempt && !pathways.is_e_verify && (
                    <span className="inline-flex items-center border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-xs font-medium text-[#ccd6cf]/60">
                      Standard H-1B sponsor · subject to the annual lottery
                    </span>
                  )}
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <WatchButton companyId={data.company.id} />
                <Link href={data.profile_url} className="term-btn">
                  View company profile
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Score gauge */}
            <aside className="flex shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-8 py-6 lg:w-72">
              <ConfidenceRing score={data.score} />
            </aside>
          </div>

          {/* Stats strip */}
          <div className="mt-8 grid grid-cols-2 gap-y-6 border-t border-[rgba(120,200,160,0.12)] pt-6 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 px-1">
                <p className="term-label">{s.label}</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums leading-none text-[#38e08a] sm:text-[26px]">
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          {/* Top states / roles */}
          {(m.top_states.length > 0 || m.top_titles.length > 0) && (
            <div className="mt-6 grid gap-6 border-t border-[rgba(120,200,160,0.12)] pt-6 sm:grid-cols-2">
              {m.top_states.length > 0 && (
                <div>
                  <p className="term-label">Top worksite states</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.top_states.slice(0, 6).map((s) => (
                      <span key={s} className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2 py-0.5 text-xs font-medium text-[#ccd6cf]/70">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {m.top_titles.length > 0 && (
                <div>
                  <p className="term-label">Top sponsored roles</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.top_titles.slice(0, 4).map((t) => (
                      <span key={t} className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2 py-0.5 text-xs font-medium text-[#ccd6cf]/70">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Petition history */}
        {series.length > 1 && maxApproved > 0 && (
          <section className="term-panel mt-6 p-6">
            <h2 className="text-[15px] font-semibold text-white">Approved H-1B petitions by year</h2>
            <p className="mt-0.5 text-[13px] text-[#ccd6cf]/55">USCIS approvals (initial + continuing), most recent complete fiscal years.</p>
            <div className="mt-6 flex h-40 gap-3 sm:gap-5">
              {series.map((s) => (
                <div key={s.year} className="flex flex-1 flex-col justify-end">
                  <span className="mb-1.5 text-center text-xs font-semibold tabular-nums text-[#ccd6cf]/80">
                    {s.approved.toLocaleString()}
                  </span>
                  <div
                    className="w-full bg-[#38e08a]"
                    style={{ height: `${6 + (s.approved / maxApproved) * 82}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-3 sm:gap-5">
              {series.map((s) => (
                <span key={s.year} className="flex-1 text-center text-[11px] font-medium tabular-nums text-[#ccd6cf]/45">
                  FY{s.year}
                </span>
              ))}
            </div>
          </section>
        )}

        {layoffSignal && (
          <div className="mt-6">
            <LayoffSignalCard signal={layoffSignal} />
          </div>
        )}

        {/* H-1B salaries */}
        {wageBreakdown.roles.length > 0 && (
          <section className="term-panel mt-6 p-6">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-white">H-1B salaries</h2>
                <p className="mt-0.5 text-[13px] text-[#ccd6cf]/55">Median prevailing wage by role, filed with the DOL.</p>
              </div>
              <Link href="/h1b-salaries" className="shrink-0 text-[13px] font-semibold text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
                Explore →
              </Link>
            </div>
            <ul className="mt-4 divide-y divide-[rgba(120,200,160,0.12)]">
              {wageBreakdown.roles.slice(0, 5).map((r) => {
                const lbl = wageLabels.get(r.soc_group)
                return (
                  <li key={r.soc_group} className="flex items-center justify-between py-2.5 text-sm">
                    {lbl ? (
                      <Link href={`/h1b-salaries/by-role/${lbl.slug}`} className="font-medium text-[#ccd6cf]/80 hover:text-white hover:underline">
                        {lbl.label}
                      </Link>
                    ) : (
                      <span className="font-medium text-[#ccd6cf]/80">{r.soc_group}</span>
                    )}
                    <span className="tabular-nums font-semibold text-[#38e08a]">
                      {fmtUsd(r.p50)} <span className="ml-1 text-xs font-normal text-[#ccd6cf]/45">n={r.n}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <ScorecardShare data={data} />

        {/* Personal CTA (flat terminal panel) */}
        <div className="term-panel mt-6 flex flex-col items-center gap-4 p-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="text-lg font-semibold text-white">
              How do <em>you</em> stack up at {data.company.name}?
            </p>
            <p className="mt-1 text-sm text-[#ccd6cf]/60">Get your own sponsorability scorecard in 60 seconds.</p>
          </div>
          <Link href="/signup?next=%2Fdashboard%2Fscorecard" className="term-btn term-btn-amber shrink-0">
            Get your scorecard
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <ScorecardMethodologyNote />
      </main>
    </div>
  )
}
