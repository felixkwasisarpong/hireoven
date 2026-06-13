import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ShieldCheck } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyParam, companySlug } from "@/lib/seo/company-seo"

// Cached hourly — the ranking sort shouldn't run on every request.
export const revalidate = 3600

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
const YEAR = new Date().getFullYear()

type Props = { params: Promise<{ slug: string }> }

type Sponsor = { id: string; name: string; domain: string | null; logo_url: string | null; h1b_sponsor_count_1yr: number | null }
type IndustryRow = { industry: string; sponsors: number }
type Data = { industry: string; others: IndustryRow[]; sponsors: Sponsor[]; total: number }

async function listIndustries(): Promise<IndustryRow[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<IndustryRow>(
    `SELECT industry, count(*)::int AS sponsors
       FROM companies
      WHERE is_active = true AND sponsors_h1b = true
        AND COALESCE(h1b_sponsor_count_1yr, 0) > 0
        AND industry IS NOT NULL AND industry <> ''
      GROUP BY industry HAVING count(*) >= 5
      ORDER BY sponsors DESC`,
  )
  return rows
}

async function getData(slug: string): Promise<Data | null> {
  if (!hasPostgresEnv()) return null
  const pool = getPostgresPool()
  const industries = await listIndustries()
  const match = industries.find((r) => companySlug(r.industry) === slug)
  if (!match) return null

  const { rows } = await pool.query<Sponsor>(
    `SELECT id, name, domain, logo_url, h1b_sponsor_count_1yr
       FROM companies
      WHERE is_active = true AND sponsors_h1b = true
        AND COALESCE(h1b_sponsor_count_1yr, 0) > 0 AND industry = $1
      ORDER BY h1b_sponsor_count_1yr DESC NULLS LAST
      LIMIT 100`,
    [match.industry],
  )
  return {
    industry: match.industry,
    total: match.sponsors,
    sponsors: rows,
    others: industries.filter((r) => r.industry !== match.industry).slice(0, 14),
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getData((await params).slug)
  if (!d) return { title: "H-1B sponsors by industry — Hireoven" }
  return {
    title: `${d.industry} companies that sponsor H-1B visas (${YEAR}) — Hireoven`,
    description: `${d.total.toLocaleString()} ${d.industry} companies that sponsor H-1B visas, ranked by certified LCA filings. ${YEAR} U.S. Department of Labor data on Hireoven.`,
    alternates: { canonical: `${BASE}/h1b-sponsors/industry/${companySlug(d.industry)}` },
    openGraph: {
      title: `${d.industry} companies that sponsor H-1B visas`,
      description: `${d.total.toLocaleString()} sponsors ranked by certified LCA filings.`,
      type: "website",
    },
  }
}

export default async function IndustryHub({ params }: Props) {
  const d = await getData((await params).slug)
  if (!d) notFound()

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${d.industry} H-1B sponsor companies (${YEAR})`,
    itemListElement: d.sponsors.slice(0, 50).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      url: `${BASE}/h1b-sponsors/${companyParam(c.id, c.name)}`,
    })),
  }

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <nav className="mb-6 flex items-center gap-1.5 text-[13px] text-slate-500">
          <Link href="/h1b-sponsors" className="hover:text-slate-800">H-1B sponsors</Link>
          <span className="text-slate-300">/</span>
          <span className="text-slate-700">{d.industry}</span>
        </nav>

        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> {d.total.toLocaleString()} sponsors
          </span>
          <h1 className="mt-3 text-[30px] font-bold leading-tight tracking-tight sm:text-[34px]">
            {d.industry} companies that sponsor H-1B visas
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
            {d.industry} employers with a record of H-1B sponsorship, ranked by certified LCA filings over the last 12
            months. Each links to its full sponsorship breakdown and the roles it&apos;s hiring for now.
          </p>
        </header>

        <ol className="mt-8 space-y-2">
          {d.sponsors.map((c, i) => (
            <li key={c.id}>
              <Link
                href={`/h1b-sponsors/${companyParam(c.id, c.name)}`}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 transition hover:border-emerald-200 hover:shadow-sm sm:px-4"
              >
                <span className="w-6 shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-400">{i + 1}</span>
                <CompanyLogo companyName={c.name} domain={c.domain} logoUrl={c.logo_url} className="h-10 w-10 shrink-0 rounded-xl border border-slate-200/70 bg-white" />
                <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-900">{c.name}</p>
                <div className="shrink-0 text-right">
                  <p className="text-[15px] font-bold tabular-nums text-slate-900">{(c.h1b_sponsor_count_1yr ?? 0).toLocaleString()}</p>
                  <p className="text-[10.5px] leading-tight text-slate-400">LCAs · 12 mo</p>
                </div>
              </Link>
            </li>
          ))}
        </ol>

        {d.others.length > 0 && (
          <section className="mt-12 border-t border-slate-200 pt-6">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">H-1B sponsors by industry</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.others.map((o) => (
                <Link
                  key={o.industry}
                  href={`/h1b-sponsors/industry/${companySlug(o.industry)}`}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition hover:border-emerald-200 hover:text-slate-900"
                >
                  {o.industry}
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-slate-400">
          Based on U.S. Department of Labor LCA disclosure data and Hireoven&apos;s live job index. Last reviewed {YEAR}.
        </p>
      </main>
    </div>
  )
}
