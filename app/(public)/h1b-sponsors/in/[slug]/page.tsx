import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { MapPin } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyParam, companySlug } from "@/lib/seo/company-seo"
import { siteBaseUrl } from "@/lib/seo/site-url"

export const revalidate = 3600

const BASE = siteBaseUrl()
const YEAR = new Date().getFullYear()

type Props = { params: Promise<{ slug: string }> }

type City = { city: string; state: string; n: number }
type Sponsor = { company_id: string | null; name: string; domain: string | null; logo_url: string | null; n: number }
type Data = { city: string; state: string; total: number; sponsors: Sponsor[]; others: City[] }

function citySlug(c: { city: string; state: string }): string {
  return `${companySlug(c.city)}-${c.state.toLowerCase()}`
}

async function topCities(): Promise<City[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<City>(
    `SELECT worksite_city AS city, worksite_state_abbr AS state, count(*)::int AS n
       FROM lca_records
      WHERE worksite_city IS NOT NULL AND worksite_state_abbr IS NOT NULL
      GROUP BY 1, 2 HAVING count(*) >= 100
      ORDER BY n DESC LIMIT 200`,
  )
  return rows
}

async function getData(slug: string): Promise<Data | null> {
  if (!hasPostgresEnv()) return null
  const cities = await topCities()
  const match = cities.find((c) => citySlug(c) === slug)
  if (!match) return null

  const pool = getPostgresPool()
  const { rows } = await pool.query<Sponsor>(
    `SELECT lr.company_id, COALESCE(c.name, lr.employer_name) AS name, c.domain, c.logo_url, count(*)::int AS n
       FROM lca_records lr
       LEFT JOIN companies c ON c.id = lr.company_id
      WHERE lr.worksite_city = $1 AND lr.worksite_state_abbr = $2
      GROUP BY lr.company_id, COALESCE(c.name, lr.employer_name), c.domain, c.logo_url
      ORDER BY n DESC LIMIT 50`,
    [match.city, match.state],
  )
  return { city: match.city, state: match.state, total: match.n, sponsors: rows, others: cities.filter((c) => c !== match).slice(0, 16) }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getData((await params).slug)
  if (!d) return { title: "H-1B sponsors by city — Hireoven" }
  const loc = `${d.city}, ${d.state}`
  return {
    title: `Top H-1B sponsor companies in ${loc} (${YEAR}) — Hireoven`,
    description: `Companies that sponsor H-1B visas in ${loc}, ranked by certified LCA filings. ${d.total.toLocaleString()} filings on record. ${YEAR} U.S. Department of Labor data.`,
    alternates: { canonical: `${BASE}/h1b-sponsors/in/${citySlug(d)}` },
    openGraph: { title: `H-1B sponsors in ${loc}`, description: `Ranked by certified LCA filings · ${d.total.toLocaleString()} on record`, type: "website" },
  }
}

export default async function CityHub({ params }: Props) {
  const d = await getData((await params).slug)
  if (!d) notFound()
  const loc = `${d.city}, ${d.state}`

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `H-1B sponsor companies in ${loc} (${YEAR})`,
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
          <span className="text-[#ccd6cf]/70">{loc}</span>
        </nav>

        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-xs font-semibold text-[#ccd6cf]/80">
            <MapPin className="h-3.5 w-3.5 text-[#f5a623]" /> <span className="tabular-nums text-[#38e08a]">{d.total.toLocaleString()}</span> LCA filings
          </span>
          <h1 className="mt-4 text-[2rem] font-semibold leading-tight tracking-tight text-white sm:text-[2.5rem]">Top <span className="text-[#f5a623]">H-1B sponsors</span> in {loc}<span className="ml-1 inline-block w-[0.5ch] animate-pulse text-[#38e08a]">_</span></h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[#ccd6cf]/70">
            Employers that sponsor H-1B visas at worksites in {loc}, ranked by certified Labor Condition Applications. Each links to its full sponsorship breakdown.
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
                <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#ccd6cf] group-hover:text-white">{s.name}</p>
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
            <h2 className="term-label">{"// H-1B sponsors in other cities"}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.others.map((o) => (
                <Link key={citySlug(o)} href={`/h1b-sponsors/in/${citySlug(o)}`} className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1.5 text-[12.5px] text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]">
                  {o.city}, {o.state}
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">Based on U.S. Department of Labor LCA disclosure data. Last reviewed {YEAR}.</p>
      </main>
    </div>
  )
}
