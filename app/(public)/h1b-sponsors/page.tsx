import type { Metadata } from "next"
import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyParam } from "@/lib/seo/company-seo"

// Cached hourly (ISR) — the ranking sort shouldn't run on every request.
export const revalidate = 3600

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
const YEAR = new Date().getFullYear()

type Row = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  industry: string | null
  h1b_sponsor_count_1yr: number | null
  h1b_sponsor_count_3yr: number | null
}

async function getTopSponsors(): Promise<Row[]> {
  if (!hasPostgresEnv()) return []
  const pool = getPostgresPool()
  const { rows } = await pool.query<Row>(
    `SELECT id, name, domain, logo_url, industry, h1b_sponsor_count_1yr, h1b_sponsor_count_3yr
       FROM companies
      WHERE is_active = true
        AND sponsors_h1b = true
        AND COALESCE(h1b_sponsor_count_1yr, 0) > 0
      ORDER BY h1b_sponsor_count_1yr DESC NULLS LAST
      LIMIT 150`,
  )
  return rows
}

export const metadata: Metadata = {
  title: `Top H-1B sponsor companies (${YEAR}) — Hireoven`,
  description: `The companies sponsoring the most H-1B visas in ${YEAR}, ranked by certified LCA filings from U.S. Department of Labor data. See who sponsors, how many, and which are hiring now.`,
  alternates: { canonical: `${BASE}/h1b-sponsors` },
  openGraph: {
    title: `Top H-1B sponsor companies (${YEAR})`,
    description: "Ranked by certified LCA filings. Find sponsor-friendly employers and the roles they're hiring for.",
    type: "website",
  },
}

export default async function H1bSponsorsHub() {
  const sponsors = await getTopSponsors()

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Top H-1B sponsor companies (${YEAR})`,
    itemListElement: sponsors.slice(0, 50).map((c, i) => ({
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
        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> {YEAR} DOL data
          </span>
          <h1 className="mt-3 text-[30px] font-bold leading-tight tracking-tight sm:text-[36px]">
            Top H-1B sponsor companies
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
            Ranked by certified LCA filings over the last 12 months. Every company links to its full sponsorship
            breakdown — petition history, sponsorship confidence, and the roles they&apos;re hiring for right now.
          </p>
        </header>

        <ol className="mt-8 space-y-2">
          {sponsors.map((c, i) => (
            <li key={c.id}>
              <Link
                href={`/h1b-sponsors/${companyParam(c.id, c.name)}`}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 transition hover:border-emerald-200 hover:shadow-sm sm:px-4"
              >
                <span className="w-6 shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-400">{i + 1}</span>
                <CompanyLogo
                  companyName={c.name}
                  domain={c.domain}
                  logoUrl={c.logo_url}
                  className="h-10 w-10 shrink-0 rounded-xl border border-slate-200/70 bg-white"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-slate-900">{c.name}</p>
                  {c.industry && <p className="truncate text-[12px] text-slate-500">{c.industry}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[15px] font-bold tabular-nums text-slate-900">
                    {(c.h1b_sponsor_count_1yr ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[10.5px] leading-tight text-slate-400">LCAs · 12 mo</p>
                </div>
              </Link>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-[12px] leading-relaxed text-slate-400">
          Based on U.S. Department of Labor LCA disclosure data and Hireoven&apos;s live job index. Counts reflect
          certified Labor Condition Applications, a leading indicator of H-1B sponsorship. Last reviewed {YEAR}.
        </p>
      </main>
    </div>
  )
}
