import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowRight, Banknote, Briefcase, HelpCircle } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { sqlSeoVisibleJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyIdFromParam, companyParam } from "@/lib/seo/company-seo"
import { siteBaseUrl } from "@/lib/seo/site-url"

export const dynamic = "force-dynamic"

const BASE = siteBaseUrl()
const YEAR = new Date().getFullYear()
// Annual-salary floor — excludes hourly rows so the median isn't polluted.
const ANNUAL_FLOOR = 20_000

type Props = { params: Promise<{ company: string }> }

type Company = { id: string; name: string; domain: string | null; logo_url: string | null; industry: string | null }
type Agg = { n: number; median: number | null; p25: number | null; p75: number | null; lo: number | null; hi: number | null; currency: string | null }
type Role = { title: string; salary_min: number | null; salary_max: number | null }
type Data = { company: Company; agg: Agg; roles: Role[] }

function fmt(n: number | null | undefined, currency = "USD"): string {
  if (n == null) return "—"
  const sym = currency === "USD" || !currency ? "$" : ""
  return `${sym}${Math.round(n).toLocaleString()}`
}

async function getData(param: string): Promise<Data | null> {
  if (!hasPostgresEnv()) return null
  const id = companyIdFromParam(param)
  if (!id) return null
  const pool = getPostgresPool()

  const cRes = await pool.query<Company>(
    `SELECT id, name, domain, logo_url, industry FROM companies WHERE id = $1::uuid LIMIT 1`,
    [id],
  )
  const company = cRes.rows[0]
  if (!company) return null

  const where = `company_id = $1::uuid AND is_active = true
     AND salary_min IS NOT NULL AND salary_max IS NOT NULL AND salary_min >= ${ANNUAL_FLOOR}
     AND ${sqlSeoVisibleJob("jobs")} AND ${sqlJobLocatedInUsa("jobs")}`

  const aggRes = await pool.query<Agg>(
    `SELECT count(*)::int AS n,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY (salary_min + salary_max) / 2.0) AS median,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY (salary_min + salary_max) / 2.0) AS p25,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY (salary_min + salary_max) / 2.0) AS p75,
            min(salary_min) AS lo, max(salary_max) AS hi, max(salary_currency) AS currency
       FROM jobs WHERE ${where}`,
    [id],
  )
  const agg = aggRes.rows[0]
  if (!agg) return null

  const rolesRes = await pool.query<Role>(
    `SELECT DISTINCT ON (title) title, salary_min, salary_max
       FROM jobs WHERE ${where}
      ORDER BY title, salary_max DESC`,
    [id],
  )
  const roles = rolesRes.rows
    .sort((a, b) => (b.salary_max ?? 0) - (a.salary_max ?? 0))
    .slice(0, 6)

  return { company, agg, roles }
}

function faqItems(d: Data): Array<{ q: string; a: string }> {
  const { company, agg } = d
  const cur = agg.currency ?? "USD"
  return [
    {
      q: `What is the median salary at ${company.name}?`,
      a: `Based on ${agg.n.toLocaleString()} salaried US roles currently posted, the median total pay at ${company.name} is about ${fmt(agg.median, cur)} per year.`,
    },
    {
      q: `What is the salary range at ${company.name}?`,
      a: `Most posted roles fall between ${fmt(agg.p25, cur)} and ${fmt(agg.p75, cur)}, with the full range spanning ${fmt(agg.lo, cur)} to ${fmt(agg.hi, cur)}.`,
    },
    {
      q: `Does ${company.name} publish salaries?`,
      a: `These figures come from ${company.name}'s own job postings (salary ranges disclosed on listings), aggregated by Hireoven. Actual offers vary by level, location and negotiation.`,
    },
  ]
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getData((await params).company)
  if (!d) return { title: "Company salaries — Hireoven" }
  const cur = d.agg.currency ?? "USD"
  return {
    title: `${d.company.name} salaries: median ${fmt(d.agg.median, cur)} (${YEAR}) — Hireoven`,
    description: `What does ${d.company.name} pay? Median ${fmt(d.agg.median, cur)}, with most roles between ${fmt(d.agg.p25, cur)} and ${fmt(d.agg.p75, cur)}, from ${d.agg.n.toLocaleString()} posted US salaries. ${YEAR} data.`,
    alternates: { canonical: `${BASE}/salaries/${companyParam(d.company.id, d.company.name)}` },
    openGraph: {
      title: `What does ${d.company.name} pay?`,
      description: `Median ${fmt(d.agg.median, cur)} · ${fmt(d.agg.p25, cur)}–${fmt(d.agg.p75, cur)} typical · ${d.agg.n.toLocaleString()} posted salaries`,
      type: "website",
    },
  }
}

export default async function SalariesPage({ params }: Props) {
  const param = (await params).company
  const d = await getData(param)
  if (!d) notFound()
  if (d.agg.n < 3) redirect(`/companies/${d.company.id}`)
  const { company, agg, roles } = d
  const cur = agg.currency ?? "USD"
  const faqs = faqItems(d)
  const profilePath = `/companies/${company.id}`

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: company.name, item: `${BASE}${profilePath}` },
          { "@type": "ListItem", position: 2, name: "Salaries", item: `${BASE}/salaries/${companyParam(company.id, company.name)}` },
        ],
      },
    ],
  }

  const stats = [
    { label: "Median total pay", value: fmt(agg.median, cur) },
    { label: "25th percentile", value: fmt(agg.p25, cur) },
    { label: "75th percentile", value: fmt(agg.p75, cur) },
    { label: "Posted salaries", value: agg.n.toLocaleString() },
  ]

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <CompanyLogo companyName={company.name} domain={company.domain} logoUrl={company.logo_url} priority className="h-16 w-16 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]" />
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-xs font-semibold text-[#ccd6cf]/80">
              <Banknote className="h-3.5 w-3.5 text-[#f5a623]" /> <span className="tabular-nums text-[#38e08a]">{agg.n.toLocaleString()}</span> posted US salaries
            </span>
            <h1 className="mt-4 text-[1.9rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[2.2rem]">What does {company.name} pay?</h1>
            <p className="mt-4 text-[14px] leading-relaxed text-[#ccd6cf]/70">
              Median total pay is about <strong className="font-semibold text-[#38e08a]">{fmt(agg.median, cur)}</strong> per year, with most roles between {fmt(agg.p25, cur)} and {fmt(agg.p75, cur)} — based on salary ranges disclosed in {company.name}&apos;s own job postings.
            </p>
          </div>
        </header>

        <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="term-panel p-4">
              <p className="text-[20px] font-semibold tabular-nums text-[#38e08a]">{s.value}</p>
              <p className="term-label mt-1 leading-tight">{s.label}</p>
            </div>
          ))}
        </section>

        {roles.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-white">Highest-paying roles at {company.name}</h2>
            <div className="mt-4 divide-y divide-[rgba(120,200,160,0.12)] overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[#0e1411]">
              {roles.map((r) => (
                <div key={r.title} className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="truncate text-[14px] font-medium text-[#ccd6cf]/80">{r.title}</p>
                  <p className="shrink-0 text-[14px] font-semibold tabular-nums text-[#38e08a]">
                    {fmt(r.salary_min, cur)}<span className="text-[#ccd6cf]/35">–</span>{fmt(r.salary_max, cur)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/jobs-at/${companyParam(company.id, company.name)}`} className="term-btn term-btn-amber">
            <Briefcase className="h-4 w-4" /> See {company.name} jobs hiring now
          </Link>
          <Link href={`/signup?next=${encodeURIComponent(profilePath)}`} className="term-btn">
            Track offers &amp; negotiate <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <section className="mt-12">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><HelpCircle className="h-4.5 w-4.5 text-[#ccd6cf]/45" /> {company.name} salary FAQ</h2>
          <div className="mt-4 space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="term-panel group p-4">
                <summary className="cursor-pointer list-none text-[15px] font-semibold text-[#ccd6cf]/90 marker:hidden">{f.q}</summary>
                <p className="mt-2 text-[14px] leading-relaxed text-[#ccd6cf]/65">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">
          Salary figures are aggregated from disclosed ranges in {company.name}&apos;s active US job postings on Hireoven&apos;s live index. Annualized; hourly listings excluded. Actual compensation varies by level, location and negotiation. Last updated {YEAR}.
        </p>
      </main>
    </div>
  )
}
