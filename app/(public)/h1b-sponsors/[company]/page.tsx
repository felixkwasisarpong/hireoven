import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowRight,
  Building2,
  Briefcase,
  CalendarRange,
  CheckCircle2,
  FileCheck2,
  FileQuestion,
  HelpCircle,
  Plus,
  ShieldCheck,
} from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import RankBadge from "@/components/h1b/leaderboard/RankBadge"
import { ConfidenceRing } from "@/components/h1b/scorecard/ConfidenceRing"
import { getCompanyH1bRank, industrySlug } from "@/lib/h1b/leaderboard"
import { getCompanyLayoffSignal } from "@/lib/h1b/layoff-signal-query"
import { LayoffSignalCard } from "@/components/h1b/layoffs/LayoffSignalCard"
import { CapExemptBadge } from "@/components/h1b/badges/CapExemptBadge"
import { EverifyBadge } from "@/components/h1b/badges/EverifyBadge"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyIdFromParam, companyParam, jobsAtPath, salariesPath } from "@/lib/seo/company-seo"

export const dynamic = "force-dynamic"

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
const YEAR = new Date().getFullYear()

type Props = { params: Promise<{ company: string }> }

type Row = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  industry: string | null
  sponsors_h1b: boolean | null
  sponsorship_confidence: number | null
  h1b_sponsor_count_1yr: number | null
  h1b_sponsor_count_3yr: number | null
  job_count: number | null
  is_cap_exempt: boolean | null
  cap_exempt_reason: string | null
  cap_exempt_confidence: "high" | "medium" | "low" | null
  is_e_verify: boolean | null
}

type Verdict = "yes" | "likely" | "unknown"

type CompanyData = Row & { openUsJobs: number; verdict: Verdict }

function verdictFor(r: Row): Verdict {
  const c1 = r.h1b_sponsor_count_1yr ?? 0
  const c3 = r.h1b_sponsor_count_3yr ?? 0
  const conf = r.sponsorship_confidence ?? 0
  if (c1 > 0 || c3 > 0 || (r.sponsors_h1b && conf >= 70)) return "yes"
  if (r.sponsors_h1b || conf >= 40) return "likely"
  return "unknown"
}

async function getCompany(param: string): Promise<CompanyData | null> {
  if (!hasPostgresEnv()) return null
  const id = companyIdFromParam(param)
  if (!id) return null
  const pool = getPostgresPool()
  const { rows } = await pool.query<Row>(
    `SELECT id, name, domain, logo_url, industry, sponsors_h1b, sponsorship_confidence,
            h1b_sponsor_count_1yr, h1b_sponsor_count_3yr, job_count,
            is_cap_exempt, cap_exempt_reason, cap_exempt_confidence, is_e_verify
       FROM companies WHERE id = $1::uuid LIMIT 1`,
    [id],
  )
  const r = rows[0]
  if (!r) return null

  const jobs = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM jobs
      WHERE company_id = $1::uuid AND is_active = true
        AND ${sqlPublishedJob("jobs")} AND ${sqlJobLocatedInUsa("jobs")}`,
    [id],
  )
  return { ...r, openUsJobs: jobs.rows[0]?.n ?? 0, verdict: verdictFor(r) }
}

function verdictSentence(c: CompanyData): string {
  const c1 = c.h1b_sponsor_count_1yr ?? 0
  const c3 = c.h1b_sponsor_count_3yr ?? 0
  if (c.verdict === "yes") {
    const counts = c1 > 0
      ? `${c1.toLocaleString()} certified LCA${c1 === 1 ? "" : "s"} in the last 12 months`
      : `${c3.toLocaleString()} certified LCA${c3 === 1 ? "" : "s"} over the last 3 years`
    return `Yes — ${c.name} sponsors H-1B visas. Public Department of Labor records show ${counts}.`
  }
  if (c.verdict === "likely") {
    return `${c.name} likely sponsors H-1B visas. Our signals point to sponsorship, but recent certified LCA volume is limited — verify the specific role before applying.`
  }
  return `We found no public H-1B sponsorship record for ${c.name}. That doesn't guarantee they won't sponsor — it means no certified LCA filings surfaced in the data we track.`
}

function faqItems(c: CompanyData): Array<{ q: string; a: string }> {
  const c1 = c.h1b_sponsor_count_1yr ?? 0
  const c3 = c.h1b_sponsor_count_3yr ?? 0
  return [
    { q: `Does ${c.name} sponsor H-1B visas?`, a: verdictSentence(c) },
    {
      q: `How many H-1B / LCA petitions has ${c.name} filed?`,
      a: `${c.name} has ${c1.toLocaleString()} certified LCA filings in the last 12 months and ${c3.toLocaleString()} over the last 3 years, based on U.S. Department of Labor disclosure data.`,
    },
    {
      q: `Is ${c.name} hiring right now?`,
      a: c.openUsJobs > 0
        ? `${c.name} has ${c.openUsJobs.toLocaleString()} open US roles tracked on Hireoven right now.`
        : `We're not tracking open US roles at ${c.name} at the moment — set an alert to be notified the moment one is posted.`,
    },
    {
      q: `Does sponsoring H-1B mean ${c.name} will sponsor me?`,
      a: `Not automatically. Sponsorship is decided per role and candidate. A history of certified LCAs means the company has the legal process in place and has done it before — a strong signal, but always confirm for the specific job.`,
    },
  ]
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await getCompany((await params).company)
  if (!c) return { title: "H-1B sponsorship lookup — Hireoven" }
  const c1 = c.h1b_sponsor_count_1yr ?? 0
  const verb = c.verdict === "yes" ? "sponsors" : c.verdict === "likely" ? "likely sponsors" : "— sponsorship data for"
  return {
    title: `Does ${c.name} sponsor H-1B visas? (${YEAR}) — Hireoven`,
    description:
      c.verdict === "yes"
        ? `Yes — ${c.name} ${verb} H-1B visas. ${c1.toLocaleString()} certified LCAs in the last year, plus open roles, sponsorship confidence and how to apply. ${YEAR} DOL data.`
        : `${c.name} H-1B sponsorship: certified LCA history, sponsorship confidence, and open roles. ${YEAR} U.S. Department of Labor data on Hireoven.`,
    alternates: { canonical: `${BASE}/h1b-sponsors/${companyParam(c.id, c.name)}` },
    openGraph: {
      title: `Does ${c.name} sponsor H-1B visas?`,
      description: `${c.verdict === "yes" ? "Yes" : c.verdict === "likely" ? "Likely" : "See the data"} — ${c1.toLocaleString()} certified LCAs · ${c.openUsJobs.toLocaleString()} open US roles`,
      type: "website",
    },
  }
}

const VERDICT_UI: Record<Verdict, { label: string; tone: string; Icon: typeof CheckCircle2 }> = {
  yes: { label: "Sponsors H-1B", tone: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: CheckCircle2 },
  likely: { label: "Likely sponsors", tone: "border-amber-200 bg-amber-50 text-amber-700", Icon: ShieldCheck },
  unknown: { label: "No public record", tone: "border-slate-200 bg-slate-50 text-slate-600", Icon: FileQuestion },
}

export default async function H1bSponsorPage({ params }: Props) {
  const c = await getCompany((await params).company)
  if (!c) notFound()

  const rank = await getCompanyH1bRank(c.id)
  const layoffSignal = await getCompanyLayoffSignal(c.id)
  const faqs = faqItems(c)
  const v = VERDICT_UI[c.verdict]
  const profilePath = `/companies/${c.id}`

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "H-1B sponsors", item: `${BASE}/h1b-sponsors` },
          { "@type": "ListItem", position: 2, name: c.name, item: `${BASE}/h1b-sponsors/${companyParam(c.id, c.name)}` },
        ],
      },
      { "@type": "Organization", name: c.name, ...(c.domain ? { url: `https://${c.domain}` } : {}) },
    ],
  }

  const certified1 = c.h1b_sponsor_count_1yr ?? 0
  const certified3 = c.h1b_sponsor_count_3yr ?? 0

  const stats = [
    {
      label: "Certified LCAs · 12 mo",
      value: certified1.toLocaleString(),
      Icon: FileCheck2,
      chip: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "Certified LCAs · 3 yr",
      value: certified3.toLocaleString(),
      Icon: CalendarRange,
      chip: "bg-slate-100 text-slate-500",
    },
    {
      label: "Open US roles",
      value: c.openUsJobs.toLocaleString(),
      Icon: Briefcase,
      chip: "bg-orange-50 text-orange-600",
    },
  ]

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      <Navbar />
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500">
          <Link href="/h1b-sponsors/leaderboard" className="hover:text-slate-800">All sponsors</Link>
          {c.industry && (
            <>
              <span className="text-slate-300">/</span>
              <Link
                href={`/h1b-sponsors/leaderboard/by-industry/${industrySlug(c.industry)}`}
                className="hover:text-slate-800"
              >
                {c.industry}
              </Link>
            </>
          )}
          <span className="text-slate-300">/</span>
          <span className="text-slate-700">{c.name}</span>
        </nav>

        {/* Hero */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-stretch lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-4">
                <CompanyLogo
                  companyName={c.name}
                  domain={c.domain}
                  logoUrl={c.logo_url}
                  priority
                  className="h-20 w-20 shrink-0 rounded-2xl border border-slate-200 bg-white p-1.5 sm:h-24 sm:w-24"
                />
                <div className="min-w-0">
                  <p className="truncate text-2xl font-bold tracking-tight text-slate-900">{c.name}</p>
                  {c.industry && (
                    <span className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-slate-500">
                      <Building2 className="h-3.5 w-3.5" /> {c.industry}
                    </span>
                  )}
                </div>
              </div>

              <span className={`mt-5 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${v.tone}`}>
                <v.Icon className="h-4 w-4" />
                {v.label}
              </span>

              <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-slate-900 sm:text-[30px]">
                Does {c.name} sponsor H-1B visas?
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-600">{verdictSentence(c)}</p>

              {(rank || c.is_cap_exempt || c.is_e_verify) && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {rank && <RankBadge rank={rank} />}
                  {c.is_cap_exempt && c.cap_exempt_reason && (
                    <CapExemptBadge
                      reason={c.cap_exempt_reason}
                      confidence={c.cap_exempt_confidence ?? "low"}
                    />
                  )}
                  {c.is_e_verify && <EverifyBadge />}
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={profilePath}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[0_1px_0_rgba(0,0,0,0.06),0_2px_8px_rgba(255,92,24,0.22)] transition-colors hover:bg-primary-hover"
                >
                  <Briefcase className="h-4 w-4" />
                  {c.openUsJobs > 0 ? `View ${c.openUsJobs.toLocaleString()} open roles` : "View company profile"}
                </Link>
                <Link
                  href={`/signup?next=${encodeURIComponent(profilePath)}`}
                  className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  Get sponsor-role alerts
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Confidence gauge */}
            <aside className="flex shrink-0 flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-8 py-6 lg:w-72">
              <ConfidenceRing score={c.sponsorship_confidence ?? 0} />
              <Link
                href={`/h1b-sponsors/${companyParam(c.id, c.name)}/scorecard`}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-white"
              >
                View full scorecard
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </aside>
          </div>

          {/* Key stats — folded into the hero as a divided strip */}
          <div className="mt-8 grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 pt-6">
            {stats.map((s, i) => (
              <div
                key={s.label}
                className={i === 0 ? "pr-4 sm:pr-6" : i === stats.length - 1 ? "pl-4 sm:pl-6" : "px-4 sm:px-6"}
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${s.chip}`}>
                    <s.Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:text-[11px]">
                    {s.label}
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums leading-none text-slate-900 sm:text-[28px]">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        {layoffSignal && (
          <div className="mt-6">
            <LayoffSignalCard signal={layoffSignal} />
          </div>
        )}

        {/* Related links — plain, no card */}
        <nav
          className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-sm"
          aria-label={`More about ${c.name}`}
        >
          <span className="text-slate-400">More on {c.name}:</span>
          <Link
            href={salariesPath(c.id, c.name)}
            className="group inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
          >
            What {c.name} pays
            <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-slate-500" />
          </Link>
          <Link
            href={jobsAtPath(c.id, c.name)}
            className="group inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
          >
            Open jobs at {c.name}
            <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-slate-500" />
          </Link>
        </nav>

        {/* FAQ — one container, divided rows */}
        <section className="mt-10">
          <h2 className="flex items-center gap-2 px-1 text-lg font-bold text-slate-900">
            <HelpCircle className="h-5 w-5 text-slate-400" />
            {c.name} H-1B sponsorship FAQ
          </h2>
          <div className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {faqs.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-slate-800 marker:hidden">
                  {f.q}
                  <Plus className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-45" />
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="mt-10 text-[12px] leading-relaxed text-slate-400">
          Based on U.S. Department of Labor LCA disclosure data and Hireoven&apos;s live job index. Sponsorship is
          decided per role and candidate; always confirm for the specific position. Last reviewed {YEAR}.
        </p>
      </main>
    </div>
  )
}
