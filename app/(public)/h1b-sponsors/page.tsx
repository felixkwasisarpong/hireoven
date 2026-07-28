import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Building2, Scale, ShieldCheck } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyParam, companySlug } from "@/lib/seo/company-seo"
import { siteBaseUrl } from "@/lib/seo/site-url"

// Cached hourly (ISR) — the ranking sort shouldn't run on every request.
export const revalidate = 3600

const BASE = siteBaseUrl()
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

type BrowseFacets = {
  industries: { label: string; href: string }[]
  cities: { label: string; href: string }[]
  roles: { label: string; href: string }[]
}

// Top industry / city / occupation hubs to link from the index. Same bounded,
// indexed query shapes the sitemap uses; this page is ISR-cached hourly so the
// aggregates don't run per request.
async function getBrowseFacets(): Promise<BrowseFacets> {
  if (!hasPostgresEnv()) return { industries: [], cities: [], roles: [] }
  const pool = getPostgresPool()
  const [ind, cities, roles] = await Promise.all([
    pool.query<{ industry: string }>(
      `SELECT industry FROM companies
        WHERE is_active = true AND sponsors_h1b = true AND COALESCE(h1b_sponsor_count_1yr, 0) > 0 AND industry IS NOT NULL
        GROUP BY industry HAVING count(*) >= 5 ORDER BY count(*) DESC LIMIT 12`,
    ).catch(() => ({ rows: [] as { industry: string }[] })),
    pool.query<{ city: string; state: string }>(
      `SELECT worksite_city AS city, worksite_state_abbr AS state FROM lca_records
        WHERE worksite_city IS NOT NULL AND worksite_state_abbr IS NOT NULL
        GROUP BY 1, 2 HAVING count(*) >= 100 ORDER BY count(*) DESC LIMIT 12`,
    ).catch(() => ({ rows: [] as { city: string; state: string }[] })),
    pool.query<{ soc_title: string }>(
      `SELECT mode() WITHIN GROUP (ORDER BY soc_title) AS soc_title FROM lca_records
        WHERE soc_code IS NOT NULL AND soc_title IS NOT NULL AND soc_title <> ''
        GROUP BY soc_code HAVING count(*) >= 50 ORDER BY count(*) DESC LIMIT 12`,
    ).catch(() => ({ rows: [] as { soc_title: string }[] })),
  ])
  return {
    industries: ind.rows.map((r) => ({ label: r.industry, href: `/h1b-sponsors/industry/${companySlug(r.industry)}` })),
    cities: cities.rows.map((r) => ({ label: `${r.city}, ${r.state}`, href: `/h1b-sponsors/in/${companySlug(r.city)}-${r.state.toLowerCase()}` })),
    roles: roles.rows.filter((r) => r.soc_title).map((r) => ({ label: r.soc_title, href: `/h1b-sponsors/role/${companySlug(r.soc_title)}` })),
  }
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

function FacetGroup({ title, items }: { title: string; items: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="term-label mb-2">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1.5 text-[12.5px] text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]"
          >
            {it.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

export default async function H1bSponsorsHub() {
  const [sponsors, facets] = await Promise.all([getTopSponsors(), getBrowseFacets()])

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

  const totalLcas = sponsors.reduce((sum, c) => sum + (c.h1b_sponsor_count_1yr ?? 0), 0)
  const heroStats = [
    { value: `${sponsors.length.toLocaleString()}+`, label: "sponsors ranked", Icon: Building2 },
    { value: totalLcas.toLocaleString(), label: "certified lcas · 12 mo", Icon: Scale },
    { value: "DOL", label: "petition-backed proof", Icon: ShieldCheck },
  ]
  const ticker = sponsors.slice(0, 24).map((c) => ({ name: c.name, n: c.h1b_sponsor_count_1yr ?? 0 }))

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Live ticker strip. */}
      {ticker.length > 0 && (
        <div className="overflow-hidden border-b border-[rgba(120,200,160,0.26)] bg-[#0a0e0c] py-1.5">
          <div className="term-marquee">
            {[0, 1].map((dup) => (
              <span key={dup} className="flex shrink-0 items-center" aria-hidden={dup === 1}>
                {ticker.map((t, i) => (
                  <span key={`${dup}-${i}`} className="px-4 text-[12px] text-[#ccd6cf]/70">
                    {t.name} <span className="text-[#38e08a]">+{t.n.toLocaleString()}</span>{" "}
                    <span className="text-[#ccd6cf]/35">LCA</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      )}

      <section className="mx-auto grid w-full max-w-[78rem] gap-6 px-4 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.62fr)] lg:items-end">
        <div>
          <p className="term-label">&gt; top_sponsors --year={YEAR} --source=DOL</p>
          <h1 className="mt-4 max-w-[34rem] text-[2.4rem] font-semibold leading-[1.02] tracking-tight text-white sm:text-[3.4rem]">
            Top H-1B <span className="text-[#f5a623]">sponsor companies</span>
            <span className="ml-1 inline-block w-[0.5ch] animate-pulse text-[#38e08a]">_</span>
          </h1>
          <p className="mt-4 max-w-[34rem] text-[14px] leading-relaxed text-[#ccd6cf]/70">
            Ranked by certified LCA filings over the last 12 months. Every company links to its full sponsorship
            breakdown — petition history, sponsorship confidence, and the roles they&apos;re hiring for right now.
          </p>
          <Link href="/signup?next=%2Fdashboard%2Fonboarding" className="term-btn term-btn-amber mt-7">
            Get sponsor alerts <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)]">
          {heroStats.map(({ value, label, Icon }) => (
            <div key={label} className="flex items-center gap-4 bg-[#0e1411] p-4">
              <Icon className="h-5 w-5 shrink-0 text-[#f5a623]" />
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-none tabular-nums text-[#38e08a]">{value}</p>
                <p className="term-label mt-1">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:py-14">
        <div className="mb-2 flex items-center justify-between border-b border-[rgba(120,200,160,0.26)] pb-2">
          <span className="term-label">rank / company</span>
          <span className="term-label">lcas · 12mo</span>
        </div>
        <ol className="divide-y divide-[rgba(120,200,160,0.12)] border-x border-b border-[rgba(120,200,160,0.2)]">
          {sponsors.map((c, i) => (
            <li key={c.id}>
              <Link
                href={`/h1b-sponsors/${companyParam(c.id, c.name)}`}
                className="group flex items-center gap-3 bg-[#0e1411] px-3 py-2.5 transition-colors hover:bg-[#111a15] sm:px-4"
              >
                <span className="w-7 shrink-0 text-right text-[13px] tabular-nums text-[#ccd6cf]/35">{String(i + 1).padStart(2, "0")}</span>
                <CompanyLogo
                  companyName={c.name}
                  domain={c.domain}
                  logoUrl={c.logo_url}
                  className="h-9 w-9 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-[#ccd6cf] group-hover:text-white">{c.name}</p>
                  {c.industry && <p className="truncate text-[11px] text-[#ccd6cf]/45">{c.industry}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[15px] font-semibold tabular-nums text-[#38e08a]">
                    {(c.h1b_sponsor_count_1yr ?? 0).toLocaleString()}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ol>

        {(facets.industries.length > 0 || facets.cities.length > 0 || facets.roles.length > 0) && (
          <section className="mt-12 space-y-6">
            <h2 className="term-label">{"// browse H-1B sponsors by"}</h2>
            {facets.industries.length > 0 && (
              <FacetGroup title="Industry" items={facets.industries} />
            )}
            {facets.cities.length > 0 && (
              <FacetGroup title="City" items={facets.cities} />
            )}
            {facets.roles.length > 0 && (
              <FacetGroup title="Role" items={facets.roles} />
            )}
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">
          Based on U.S. Department of Labor LCA disclosure data and Hireoven&apos;s live job index. Counts reflect
          certified Labor Condition Applications, a leading indicator of H-1B sponsorship. Last reviewed {YEAR}.
        </p>
      </main>
    </div>
  )
}
