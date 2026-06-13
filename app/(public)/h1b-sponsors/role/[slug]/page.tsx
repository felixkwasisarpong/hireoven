import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Briefcase } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyParam, companySlug } from "@/lib/seo/company-seo"

export const revalidate = 3600

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
const YEAR = new Date().getFullYear()

type Props = { params: Promise<{ slug: string }> }

type Soc = { soc_code: string; soc_title: string; n: number }
type Sponsor = { company_id: string | null; name: string; domain: string | null; logo_url: string | null; n: number; wage: number | null }
type Data = { soc: Soc; sponsors: Sponsor[]; others: Soc[]; medianWage: number | null }

async function topSocs(): Promise<Soc[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<Soc>(
    `SELECT soc_code,
            mode() WITHIN GROUP (ORDER BY soc_title) AS soc_title,
            count(*)::int AS n
       FROM lca_records
      WHERE soc_code IS NOT NULL AND soc_title IS NOT NULL AND soc_title <> ''
      GROUP BY soc_code HAVING count(*) >= 50
      ORDER BY n DESC LIMIT 60`,
  )
  return rows
}

async function getData(slug: string): Promise<Data | null> {
  if (!hasPostgresEnv()) return null
  const socs = await topSocs()
  const match = socs.find((s) => companySlug(s.soc_title) === slug)
  if (!match) return null

  const pool = getPostgresPool()
  const [sponsorsRes, wageRes] = await Promise.all([
    pool.query<Sponsor>(
      `SELECT lr.company_id, COALESCE(c.name, lr.employer_name) AS name, c.domain, c.logo_url,
              count(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY lr.prevailing_wage) AS wage
         FROM lca_records lr
         LEFT JOIN companies c ON c.id = lr.company_id
        WHERE lr.soc_code = $1
        GROUP BY lr.company_id, COALESCE(c.name, lr.employer_name), c.domain, c.logo_url
        ORDER BY n DESC LIMIT 50`,
      [match.soc_code],
    ),
    pool.query<{ median: number | null }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY prevailing_wage) AS median
         FROM lca_records WHERE soc_code = $1 AND prevailing_wage IS NOT NULL AND prevailing_wage >= 20000`,
      [match.soc_code],
    ),
  ])
  return { soc: match, sponsors: sponsorsRes.rows, others: socs.filter((s) => s !== match).slice(0, 16), medianWage: wageRes.rows[0]?.median ?? null }
}

function money(n: number | null | undefined): string {
  return n == null ? "—" : `$${Math.round(n).toLocaleString()}`
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getData((await params).slug)
  if (!d) return { title: "H-1B sponsors by occupation — Hireoven" }
  return {
    title: `${d.soc.soc_title} — top H-1B sponsors & prevailing wage (${YEAR}) — Hireoven`,
    description: `Companies that sponsor H-1B visas for ${d.soc.soc_title} roles, ranked by certified LCAs.${d.medianWage ? ` Median prevailing wage ${money(d.medianWage)}.` : ""} ${YEAR} U.S. Department of Labor data.`,
    alternates: { canonical: `${BASE}/h1b-sponsors/role/${companySlug(d.soc.soc_title)}` },
    openGraph: { title: `${d.soc.soc_title}: top H-1B sponsors`, description: `Ranked by certified LCAs${d.medianWage ? ` · median wage ${money(d.medianWage)}` : ""}`, type: "website" },
  }
}

export default async function RoleHub({ params }: Props) {
  const d = await getData((await params).slug)
  if (!d) notFound()

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${d.soc.soc_title} H-1B sponsor companies (${YEAR})`,
    itemListElement: d.sponsors.filter((s) => s.company_id).slice(0, 50).map((s, i) => ({
      "@type": "ListItem", position: i + 1, name: s.name,
      url: `${BASE}/h1b-sponsors/${companyParam(s.company_id as string, s.name)}`,
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
          <span className="truncate text-slate-700">{d.soc.soc_title}</span>
        </nav>

        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
            <Briefcase className="h-3.5 w-3.5" /> {d.soc.n.toLocaleString()} LCA filings{d.medianWage ? ` · median ${money(d.medianWage)}` : ""}
          </span>
          <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight sm:text-[33px]">Top H-1B sponsors for {d.soc.soc_title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
            Employers that sponsor H-1B visas for {d.soc.soc_title} roles, ranked by certified Labor Condition Applications{d.medianWage ? `, with a median prevailing wage of ${money(d.medianWage)}` : ""}. Each links to its full sponsorship breakdown.
          </p>
        </header>

        <ol className="mt-8 space-y-2">
          {d.sponsors.map((s, i) => {
            const inner = (
              <>
                <span className="w-6 shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-400">{i + 1}</span>
                <CompanyLogo companyName={s.name} domain={s.domain} logoUrl={s.logo_url} className="h-10 w-10 shrink-0 rounded-xl border border-slate-200/70 bg-white" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-slate-900">{s.name}</p>
                  {s.wage != null && <p className="text-[12px] text-slate-500">median wage {money(s.wage)}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[15px] font-bold tabular-nums text-slate-900">{s.n.toLocaleString()}</p>
                  <p className="text-[10.5px] leading-tight text-slate-400">LCAs</p>
                </div>
              </>
            )
            return (
              <li key={`${s.company_id ?? s.name}-${i}`}>
                {s.company_id ? (
                  <Link href={`/h1b-sponsors/${companyParam(s.company_id, s.name)}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 transition hover:border-violet-200 hover:shadow-sm sm:px-4">{inner}</Link>
                ) : (
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 sm:px-4">{inner}</div>
                )}
              </li>
            )
          })}
        </ol>

        {d.others.length > 0 && (
          <section className="mt-12 border-t border-slate-200 pt-6">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">H-1B sponsors by occupation</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.others.map((o) => (
                <Link key={o.soc_code} href={`/h1b-sponsors/role/${companySlug(o.soc_title)}`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition hover:border-violet-200 hover:text-slate-900">
                  {o.soc_title}
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-slate-400">Based on U.S. Department of Labor LCA disclosure data (SOC {d.soc.soc_code}). Prevailing wage is the DOL-required minimum, not market pay. Last reviewed {YEAR}.</p>
      </main>
    </div>
  )
}
