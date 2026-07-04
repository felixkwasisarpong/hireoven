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

const GRADE_PILL: Record<ScoreHue, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  green: "border-green-200 bg-green-50 text-green-700",
  blue: "border-sky-200 bg-sky-50 text-sky-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  red: "border-red-200 bg-red-50 text-red-600",
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
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      <Navbar />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500">
          <Link href="/h1b-sponsors/leaderboard" className="hover:text-slate-800">All sponsors</Link>
          <span className="text-slate-300">/</span>
          <Link href={data.profile_url} className="hover:text-slate-800">{data.company.name}</Link>
          <span className="text-slate-300">/</span>
          <span className="text-slate-700">Scorecard</span>
        </nav>

        {/* Hero */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-stretch lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-4">
                <CompanyLogo
                  companyName={data.company.name}
                  domain={data.company.domain}
                  logoUrl={data.company.logo_url}
                  priority
                  className="h-20 w-20 shrink-0 rounded-2xl border border-slate-200 bg-white p-1.5 sm:h-24 sm:w-24"
                />
                <div className="min-w-0">
                  <p className="truncate text-2xl font-bold tracking-tight text-slate-900">{data.company.name}</p>
                  {data.company.industry && (
                    <span className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-slate-500">
                      <Building2 className="h-3.5 w-3.5" /> {data.company.industry}
                    </span>
                  )}
                </div>
              </div>

              <span className={`mt-5 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${GRADE_PILL[bucket.hue]}`}>
                {bucket.grade} · {bucket.label}
              </span>

              <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-slate-900 sm:text-[30px]">
                {data.company.name} H-1B sponsorability scorecard
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-600">{bucket.description}</p>

              {pathways && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {pathways.is_cap_exempt && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                      <Unlock className="h-3.5 w-3.5" /> Cap-exempt · files outside the lottery
                    </span>
                  )}
                  {pathways.is_e_verify && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                      <ShieldCheck className="h-3.5 w-3.5" /> E-Verify · STEM OPT eligible
                    </span>
                  )}
                  {!pathways.is_cap_exempt && !pathways.is_e_verify && (
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                      Standard H-1B sponsor · subject to the annual lottery
                    </span>
                  )}
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <WatchButton companyId={data.company.id} />
                <Link
                  href={data.profile_url}
                  className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  View company profile
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Score gauge */}
            <aside className="flex shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/70 px-8 py-6 lg:w-72">
              <ConfidenceRing score={data.score} />
            </aside>
          </div>

          {/* Stats strip */}
          <div className="mt-8 grid grid-cols-2 gap-y-6 border-t border-slate-100 pt-6 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 px-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:text-[11px]">
                  {s.label}
                </p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums leading-none text-slate-900 sm:text-[26px]">
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          {/* Top states / roles */}
          {(m.top_states.length > 0 || m.top_titles.length > 0) && (
            <div className="mt-6 grid gap-6 border-t border-slate-100 pt-6 sm:grid-cols-2">
              {m.top_states.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Top worksite states</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.top_states.slice(0, 6).map((s) => (
                      <span key={s} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {m.top_titles.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Top sponsored roles</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.top_titles.slice(0, 4).map((t) => (
                      <span key={t} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Petition history */}
        {series.length > 1 && maxApproved > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-[15px] font-bold text-slate-900">Approved H-1B petitions by year</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">USCIS approvals (initial + continuing), most recent complete fiscal years.</p>
            <div className="mt-6 flex h-40 gap-3 sm:gap-5">
              {series.map((s) => (
                <div key={s.year} className="flex flex-1 flex-col justify-end">
                  <span className="mb-1.5 text-center text-xs font-semibold tabular-nums text-slate-700">
                    {s.approved.toLocaleString()}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-orange-500/90"
                    style={{ height: `${6 + (s.approved / maxApproved) * 82}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-3 sm:gap-5">
              {series.map((s) => (
                <span key={s.year} className="flex-1 text-center text-[11px] font-medium tabular-nums text-slate-400">
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
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-slate-900">H-1B salaries</h2>
                <p className="mt-0.5 text-[13px] text-slate-500">Median prevailing wage by role, filed with the DOL.</p>
              </div>
              <Link href="/h1b-salaries" className="shrink-0 text-[13px] font-semibold text-orange-600 hover:text-orange-700">
                Explore →
              </Link>
            </div>
            <ul className="mt-4 divide-y divide-slate-100">
              {wageBreakdown.roles.slice(0, 5).map((r) => {
                const lbl = wageLabels.get(r.soc_group)
                return (
                  <li key={r.soc_group} className="flex items-center justify-between py-2.5 text-sm">
                    {lbl ? (
                      <Link href={`/h1b-salaries/by-role/${lbl.slug}`} className="font-medium text-slate-700 hover:text-slate-900 hover:underline">
                        {lbl.label}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-700">{r.soc_group}</span>
                    )}
                    <span className="tabular-nums font-semibold text-slate-900">
                      {fmtUsd(r.p50)} <span className="ml-1 text-xs font-normal text-slate-400">n={r.n}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <ScorecardShare data={data} />

        {/* Personal CTA (flat, no gradient) */}
        <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl bg-slate-900 p-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="text-lg font-semibold text-white">
              How do <em>you</em> stack up at {data.company.name}?
            </p>
            <p className="mt-1 text-sm text-white/60">Get your own sponsorability scorecard in 60 seconds.</p>
          </div>
          <Link
            href="/dashboard/scorecard"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_rgba(255,92,24,0.3)] transition-colors hover:bg-primary-hover"
          >
            Get your scorecard
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <ScorecardMethodologyNote />
      </main>
    </div>
  )
}
