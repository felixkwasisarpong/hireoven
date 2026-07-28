import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Briefcase } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyParam, companySlug } from "@/lib/seo/company-seo"
import { siteBaseUrl } from "@/lib/seo/site-url"

export const revalidate = 3600

const BASE = siteBaseUrl()
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
    <div className="term-page min-h-dvh">
      <Navbar />
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <nav className="mb-6 flex items-center gap-1.5 text-[13px] text-[#ccd6cf]/45">
          <Link href="/h1b-sponsors" className="hover:text-[#38e08a]">H-1B sponsors</Link>
          <span className="text-[#ccd6cf]/25">/</span>
          <span className="truncate text-[#ccd6cf]/70">{d.soc.soc_title}</span>
        </nav>

        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-xs font-semibold text-[#ccd6cf]/80">
            <Briefcase className="h-3.5 w-3.5 text-[#f5a623]" /> <span className="tabular-nums text-[#38e08a]">{d.soc.n.toLocaleString()}</span> LCA filings{d.medianWage ? ` · median ${money(d.medianWage)}` : ""}
          </span>
          <h1 className="mt-4 text-[1.9rem] font-semibold leading-tight tracking-tight text-white sm:text-[2.4rem]">Top <span className="text-[#f5a623]">H-1B sponsors</span> for {d.soc.soc_title}<span className="ml-1 inline-block w-[0.5ch] animate-pulse text-[#38e08a]">_</span></h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[#ccd6cf]/70">
            Employers that sponsor H-1B visas for {d.soc.soc_title} roles, ranked by certified Labor Condition Applications{d.medianWage ? `, with a median prevailing wage of ${money(d.medianWage)}` : ""}. Each links to its full sponsorship breakdown.
          </p>
        </header>

        <div className="mt-8 flex items-center justify-between border-b border-[rgba(120,200,160,0.26)] pb-2">
          <span className="term-label">rank / company</span>
          <span className="term-label">lcas</span>
        </div>
        <ol className="divide-y divide-[rgba(120,200,160,0.12)] border-x border-b border-[rgba(120,200,160,0.2)]">
          {d.sponsors.map((s, i) => {
            const inner = (
              <>
                <span className="w-7 shrink-0 text-right text-[13px] tabular-nums text-[#ccd6cf]/35">{String(i + 1).padStart(2, "0")}</span>
                <CompanyLogo companyName={s.name} domain={s.domain} logoUrl={s.logo_url} className="h-9 w-9 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-[#ccd6cf] group-hover:text-white">{s.name}</p>
                  {s.wage != null && <p className="text-[12px] text-[#ccd6cf]/45">median wage {money(s.wage)}</p>}
                </div>
                <p className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-[#38e08a]">{s.n.toLocaleString()}</p>
              </>
            )
            return (
              <li key={`${s.company_id ?? s.name}-${i}`}>
                {s.company_id ? (
                  <Link href={`/h1b-sponsors/${companyParam(s.company_id, s.name)}`} className="group flex items-center gap-3 bg-[#0e1411] px-3 py-2.5 transition-colors hover:bg-[#111a15] sm:px-4">{inner}</Link>
                ) : (
                  <div className="flex items-center gap-3 bg-[#0e1411] px-3 py-2.5 sm:px-4">{inner}</div>
                )}
              </li>
            )
          })}
        </ol>

        {d.others.length > 0 && (
          <section className="mt-12 border-t border-[rgba(120,200,160,0.2)] pt-6">
            <h2 className="term-label">{"// H-1B sponsors by occupation"}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.others.map((o) => (
                <Link key={o.soc_code} href={`/h1b-sponsors/role/${companySlug(o.soc_title)}`} className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1.5 text-[12.5px] text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]">
                  {o.soc_title}
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">Based on U.S. Department of Labor LCA disclosure data (SOC {d.soc.soc_code}). Prevailing wage is the DOL-required minimum, not market pay. Last reviewed {YEAR}.</p>
      </main>
    </div>
  )
}
