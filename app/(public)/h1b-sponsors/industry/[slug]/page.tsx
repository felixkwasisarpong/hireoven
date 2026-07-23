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
    <div className="term-page min-h-dvh">
      <Navbar />
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <nav className="mb-6 flex items-center gap-1.5 text-[13px] text-[#ccd6cf]/45">
          <Link href="/h1b-sponsors" className="hover:text-[#38e08a]">H-1B sponsors</Link>
          <span className="text-[#ccd6cf]/25">/</span>
          <span className="text-[#ccd6cf]/70">{d.industry}</span>
        </nav>

        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-xs font-semibold text-[#ccd6cf]/80">
            <ShieldCheck className="h-3.5 w-3.5 text-[#f5a623]" /> <span className="tabular-nums text-[#38e08a]">{d.total.toLocaleString()}</span> sponsors
          </span>
          <h1 className="mt-4 text-[2rem] font-semibold leading-tight tracking-tight text-white sm:text-[2.5rem]">
            {d.industry} companies that <span className="text-[#f5a623]">sponsor H-1B</span> visas
            <span className="ml-1 inline-block w-[0.5ch] animate-pulse text-[#38e08a]">_</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[#ccd6cf]/70">
            {d.industry} employers with a record of H-1B sponsorship, ranked by certified LCA filings over the last 12
            months. Each links to its full sponsorship breakdown and the roles it&apos;s hiring for now.
          </p>
        </header>

        <div className="mt-8 flex items-center justify-between border-b border-[rgba(120,200,160,0.26)] pb-2">
          <span className="term-label">rank / company</span>
          <span className="term-label">lcas · 12mo</span>
        </div>
        <ol className="divide-y divide-[rgba(120,200,160,0.12)] border-x border-b border-[rgba(120,200,160,0.2)]">
          {d.sponsors.map((c, i) => (
            <li key={c.id}>
              <Link
                href={`/h1b-sponsors/${companyParam(c.id, c.name)}`}
                className="group flex items-center gap-3 bg-[#0e1411] px-3 py-2.5 transition-colors hover:bg-[#111a15] sm:px-4"
              >
                <span className="w-7 shrink-0 text-right text-[13px] tabular-nums text-[#ccd6cf]/35">{String(i + 1).padStart(2, "0")}</span>
                <CompanyLogo companyName={c.name} domain={c.domain} logoUrl={c.logo_url} className="h-9 w-9 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]" />
                <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#ccd6cf] group-hover:text-white">{c.name}</p>
                <p className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-[#38e08a]">{(c.h1b_sponsor_count_1yr ?? 0).toLocaleString()}</p>
              </Link>
            </li>
          ))}
        </ol>

        {d.others.length > 0 && (
          <section className="mt-12 border-t border-[rgba(120,200,160,0.2)] pt-6">
            <h2 className="term-label">{"// H-1B sponsors by industry"}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.others.map((o) => (
                <Link
                  key={o.industry}
                  href={`/h1b-sponsors/industry/${companySlug(o.industry)}`}
                  className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1.5 text-[12.5px] text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]"
                >
                  {o.industry}
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">
          Based on U.S. Department of Labor LCA disclosure data and Hireoven&apos;s live job index. Last reviewed {YEAR}.
        </p>
      </main>
    </div>
  )
}
