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
import { sqlSeoVisibleJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { WAGE_LEVEL_META, LEGACY_SINGLE_DRAW_ODDS, type WageLevel } from "@/lib/stay/lottery-odds"
import { companyIdFromParam, companyParam, jobsAtPath, salariesPath } from "@/lib/seo/company-seo"
import { siteBaseUrl } from "@/lib/seo/site-url"

export const dynamic = "force-dynamic"

const BASE = siteBaseUrl()
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
        AND ${sqlSeoVisibleJob("jobs")} AND ${sqlJobLocatedInUsa("jobs")}`,
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

// Stay's 2026 survival-odds reframe as a single quotable sentence (GEO + FAQ).
const L1_PCT = Math.round(WAGE_LEVEL_META[1].singleDrawOdds * 100)
const L4_PCT = Math.round(WAGE_LEVEL_META[4].singleDrawOdds * 100)
const LEGACY_PCT = Math.round(LEGACY_SINGLE_DRAW_ODDS * 100)

function stayOutlookSentence(c: CompanyData): string {
  if (c.is_cap_exempt) {
    return `${c.name} is cap-exempt — it can file H-1B petitions year-round with no annual cap and no lottery, so the 2026 wage-weighted selection rule does not apply. For entry-level talent, a cap-exempt employer is the strongest structural path to staying in the U.S.`
  }
  if (c.verdict === "yes" || c.verdict === "likely") {
    return `${c.name} sponsors H-1B, but it is cap-subject, so a petition still goes through the 2026 wage-weighted lottery. Odds of selection now depend on the DOL wage level of your offer — roughly ${L1_PCT}% per draw at Level I, rising to about ${L4_PCT}% at Level IV (down from a flat ~${LEGACY_PCT}% under the old random lottery).`
  }
  return `We have no public H-1B sponsorship record for ${c.name}, so we can't estimate 2026 lottery odds here. If they don't sponsor, cap-exempt employers remain a lottery-free path to status.`
}

function faqItems(c: CompanyData): Array<{ q: string; a: string }> {
  const c1 = c.h1b_sponsor_count_1yr ?? 0
  const c3 = c.h1b_sponsor_count_3yr ?? 0
  return [
    { q: `Does ${c.name} sponsor H-1B visas?`, a: verdictSentence(c) },
    { q: `What are my H-1B lottery odds at ${c.name} in 2026?`, a: stayOutlookSentence(c) },
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

// Verdict badges keep three distinct semantic hues (dark-adapted surfaces):
// yes = green (positive), likely = amber, unknown = neutral slate.
const VERDICT_UI: Record<Verdict, { label: string; tone: string; Icon: typeof CheckCircle2 }> = {
  yes: { label: "Sponsors H-1B", tone: "border-emerald-500/30 bg-emerald-500/12 text-emerald-300", Icon: CheckCircle2 },
  likely: { label: "Likely sponsors", tone: "border-amber-500/30 bg-amber-500/12 text-amber-300", Icon: ShieldCheck },
  unknown: { label: "No public record", tone: "border-slate-500/30 bg-slate-500/12 text-slate-300", Icon: FileQuestion },
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
      {
        "@type": "Dataset",
        name: `${c.name} H-1B sponsorship record (${YEAR})`,
        description: `Certified H-1B / LCA filing counts, sponsorship confidence, cap-exempt status, and 2026 wage-weighted lottery outlook for ${c.name}, derived from U.S. Department of Labor disclosure data.`,
        creator: { "@type": "Organization", name: "Hireoven", url: BASE },
        temporalCoverage: `${YEAR - 3}/${YEAR}`,
        isAccessibleForFree: true,
        variableMeasured: [
          "Certified LCA count (last 12 months)",
          "Certified LCA count (last 3 years)",
          "Sponsorship confidence",
          "Cap-exempt status",
        ],
        url: `${BASE}/h1b-sponsors/${companyParam(c.id, c.name)}`,
      },
    ],
  }

  const certified1 = c.h1b_sponsor_count_1yr ?? 0
  const certified3 = c.h1b_sponsor_count_3yr ?? 0

  const stats = [
    {
      label: "Certified LCAs · 12 mo",
      value: certified1.toLocaleString(),
      Icon: FileCheck2,
    },
    {
      label: "Certified LCAs · 3 yr",
      value: certified3.toLocaleString(),
      Icon: CalendarRange,
    },
    {
      label: "Open US roles",
      value: c.openUsJobs.toLocaleString(),
      Icon: Briefcase,
    },
  ]

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-[13px] text-[#ccd6cf]/45">
          <Link href="/h1b-sponsors/leaderboard" className="hover:text-[#38e08a]">All sponsors</Link>
          {c.industry && (
            <>
              <span className="text-[#ccd6cf]/25">/</span>
              <Link
                href={`/h1b-sponsors/leaderboard/by-industry/${industrySlug(c.industry)}`}
                className="hover:text-[#38e08a]"
              >
                {c.industry}
              </Link>
            </>
          )}
          <span className="text-[#ccd6cf]/25">/</span>
          <span className="text-[#ccd6cf]/70">{c.name}</span>
        </nav>

        {/* Hero */}
        <section className="term-panel p-6 sm:p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-stretch lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-4">
                <CompanyLogo
                  companyName={c.name}
                  domain={c.domain}
                  logoUrl={c.logo_url}
                  priority
                  className="h-20 w-20 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-1.5 sm:h-24 sm:w-24"
                />
                <div className="min-w-0">
                  <p className="truncate text-2xl font-semibold tracking-tight text-white">{c.name}</p>
                  {c.industry && (
                    <span className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-[#ccd6cf]/55">
                      <Building2 className="h-3.5 w-3.5 text-[#ccd6cf]/60" /> {c.industry}
                    </span>
                  )}
                </div>
              </div>

              <span className={`mt-5 inline-flex items-center gap-1.5 border px-3.5 py-1.5 text-sm font-semibold ${v.tone}`}>
                <v.Icon className="h-4 w-4" />
                {v.label}
              </span>

              <h1 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-white sm:text-[30px]">
                Does {c.name} sponsor <span className="text-[#f5a623]">H-1B visas</span>?
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#ccd6cf]/70">{verdictSentence(c)}</p>

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
                <Link href={profilePath} className="term-btn term-btn-amber">
                  <Briefcase className="h-4 w-4" />
                  {c.openUsJobs > 0 ? `View ${c.openUsJobs.toLocaleString()} open roles` : "View company profile"}
                </Link>
                <Link href={`/signup?next=${encodeURIComponent(profilePath)}`} className="term-btn">
                  Get sponsor-role alerts
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Confidence gauge */}
            <aside className="flex shrink-0 flex-col items-center justify-center gap-4 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-8 py-6 lg:w-72">
              <ConfidenceRing score={c.sponsorship_confidence ?? 0} />
              <Link
                href={`/h1b-sponsors/${companyParam(c.id, c.name)}/scorecard`}
                className="term-btn w-full justify-center"
              >
                View full scorecard
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </aside>
          </div>

          {/* Key stats — folded into the hero as a divided strip */}
          <div className="mt-8 grid grid-cols-3 divide-x divide-[rgba(120,200,160,0.12)] border-t border-[rgba(120,200,160,0.12)] pt-6">
            {stats.map((s, i) => (
              <div
                key={s.label}
                className={i === 0 ? "pr-4 sm:pr-6" : i === stats.length - 1 ? "pl-4 sm:pl-6" : "px-4 sm:px-6"}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]">
                    <s.Icon className="h-3.5 w-3.5 text-[#f5a623]" />
                  </span>
                  <span className="term-label">{s.label}</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums leading-none text-[#38e08a] sm:text-[28px]">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Stay — 2026 survival-odds outlook (the differentiator) */}
        <section className="term-panel mt-6 p-6 sm:p-8">
          <p className="term-label">Stay</p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            Will {c.name} keep you in the U.S.? <span className="text-[#ccd6cf]/45">— the 2026 outlook</span>
          </h2>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-[#ccd6cf]/70">{stayOutlookSentence(c)}</p>

          {c.is_cap_exempt ? (
            <div className="mt-5 border border-[#38e08a]/30 bg-[#38e08a]/[0.07] p-4">
              <p className="text-[13px] font-semibold text-[#38e08a]">Lottery-free path</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[#ccd6cf]/80">
                Cap-exempt filing means no annual cap and no lottery — the 2026 weighted-selection rule doesn&apos;t
                touch this employer. Pay is often lower, but your odds of staying are dramatically higher.
              </p>
            </div>
          ) : c.verdict !== "unknown" ? (
            <div className="mt-5">
              <p className="term-label mb-2">your draw odds by DOL wage level · 2026 weighted lottery</p>
              <div className="grid grid-cols-2 gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-4">
                {([1, 2, 3, 4] as WageLevel[]).map((lv) => {
                  const pct = Math.round(WAGE_LEVEL_META[lv].singleDrawOdds * 100)
                  const color = pct < 20 ? "#e5695f" : pct < 40 ? "#f5a623" : "#38e08a"
                  return (
                    <div key={lv} className="bg-[#0e1411] p-4">
                      <p className="term-label">{WAGE_LEVEL_META[lv].label}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums leading-none" style={{ color }}>
                        {pct}%
                      </p>
                      <p className="term-label mt-1">per draw</p>
                    </div>
                  )
                })}
              </div>
              <p className="mt-2 text-[12px] text-[#ccd6cf]/45">
                Old random lottery: ~{LEGACY_PCT}% for everyone → now weighted by salary. STEM OPT stacks ~3 draws.
              </p>
            </div>
          ) : null}

          <Link
            href="/stay/timeline"
            className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
          >
            Get your personalized odds — salary + OPT clock
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
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
          <span className="text-[#ccd6cf]/45">More on {c.name}:</span>
          <Link
            href={salariesPath(c.id, c.name)}
            className="group inline-flex items-center gap-1 font-medium text-[#ccd6cf]/80 hover:text-white"
          >
            What {c.name} pays
            <ArrowRight className="h-3.5 w-3.5 text-[#ccd6cf]/35 transition-colors group-hover:text-[#38e08a]" />
          </Link>
          <Link
            href={jobsAtPath(c.id, c.name)}
            className="group inline-flex items-center gap-1 font-medium text-[#ccd6cf]/80 hover:text-white"
          >
            Open jobs at {c.name}
            <ArrowRight className="h-3.5 w-3.5 text-[#ccd6cf]/35 transition-colors group-hover:text-[#38e08a]" />
          </Link>
        </nav>

        {/* FAQ — one container, divided rows */}
        <section className="mt-10">
          <h2 className="flex items-center gap-2 px-1 text-lg font-semibold text-white">
            <HelpCircle className="h-5 w-5 text-[#f5a623]" />
            {c.name} H-1B sponsorship FAQ
          </h2>
          <div className="mt-4 divide-y divide-[rgba(120,200,160,0.12)] overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[#0e1411]">
            {faqs.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-[#ccd6cf] marker:hidden">
                  {f.q}
                  <Plus className="h-4 w-4 shrink-0 text-[#f5a623] transition-transform duration-200 group-open:rotate-45" />
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-[#ccd6cf]/70">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">
          Based on U.S. Department of Labor LCA disclosure data and Hireoven&apos;s live job index. Sponsorship is
          decided per role and candidate; always confirm for the specific position. Last reviewed {YEAR}.
        </p>
      </main>
    </div>
  )
}
