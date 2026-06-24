import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, Building2, Briefcase, CheckCircle2, FileQuestion, HelpCircle, ShieldCheck } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import RankBadge from "@/components/h1b/leaderboard/RankBadge"
import { ScorecardBadge } from "@/components/h1b/scorecard/ScorecardBadge"
import { getCompanyH1bRank, industrySlug } from "@/lib/h1b/leaderboard"
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
            h1b_sponsor_count_1yr, h1b_sponsor_count_3yr, job_count
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

  const stats: Array<{ label: string; value: string }> = [
    { label: "Certified LCAs · 12 mo", value: (c.h1b_sponsor_count_1yr ?? 0).toLocaleString() },
    { label: "Certified LCAs · 3 yr", value: (c.h1b_sponsor_count_3yr ?? 0).toLocaleString() },
    { label: "Sponsorship confidence", value: `${c.sponsorship_confidence ?? 0}%` },
    { label: "Open US roles", value: c.openUsJobs.toLocaleString() },
  ]

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <nav className="mb-6 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500">
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

        <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <CompanyLogo
            companyName={c.name}
            domain={c.domain}
            logoUrl={c.logo_url}
            priority
            className="h-16 w-16 shrink-0 rounded-2xl border border-slate-200/70 bg-white"
          />
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${v.tone}`}>
              <v.Icon className="h-3.5 w-3.5" />
              {v.label}
            </span>
            <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">
              Does {c.name} sponsor H-1B visas?
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{verdictSentence(c)}</p>
            {c.industry && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-slate-400">
                <Building2 className="h-3.5 w-3.5" /> {c.industry}
              </p>
            )}
            {rank && (
              <div className="mt-3">
                <RankBadge rank={rank} />
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ScorecardBadge score={c.sponsorship_confidence ?? 0} />
              <Link
                href={`/h1b-sponsors/${companyParam(c.id, c.name)}/scorecard`}
                className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
              >
                View scorecard →
              </Link>
            </div>
          </div>
        </header>

        <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[22px] font-bold tabular-nums text-slate-900">{s.value}</p>
              <p className="mt-0.5 text-[11.5px] leading-tight text-slate-500">{s.label}</p>
            </div>
          ))}
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={profilePath}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <Briefcase className="h-4 w-4" />
            {c.openUsJobs > 0 ? `View ${c.openUsJobs.toLocaleString()} open roles` : "View company profile"}
          </Link>
          <Link
            href={`/signup?next=${encodeURIComponent(profilePath)}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
          >
            Get alerts for sponsor-friendly roles
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <nav className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-slate-500" aria-label="More about this company">
          <span className="text-slate-400">More on {c.name}:</span>
          <Link href={salariesPath(c.id, c.name)} className="font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline">
            What {c.name} pays
          </Link>
          <Link href={jobsAtPath(c.id, c.name)} className="font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline">
            Open jobs at {c.name}
          </Link>
        </nav>

        <section className="mt-12">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <HelpCircle className="h-4.5 w-4.5 text-slate-400" />
            {c.name} H-1B sponsorship FAQ
          </h2>
          <div className="mt-4 space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-slate-200 bg-white p-4 open:shadow-sm">
                <summary className="cursor-pointer list-none text-[15px] font-semibold text-slate-800 marker:hidden">
                  {f.q}
                </summary>
                <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{f.a}</p>
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
