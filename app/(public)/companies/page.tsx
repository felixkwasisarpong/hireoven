import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, BellRing, Building2, ShieldCheck } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import Navbar from "@/components/layout/Navbar"
import type { Company } from "@/types"

export const metadata: Metadata = {
  title: "Browse Companies - Hireoven",
  description:
    "Explore companies hiring now. Filter by H1B sponsorship, industry, and more. See jobs the moment they're posted.",
}

export const revalidate = 3600

const COMPANY_STAT_ICONS = {
  companies: Building2,
  roles: BellRing,
  sponsor: ShieldCheck,
}

function SponsorsH1BBadge({ confidence }: { confidence: number }) {
  if (confidence >= 80)
    return (
      <span className="border border-[#f5a623]/30 bg-[#f5a623]/12 px-2 py-0.5 text-[11px] font-semibold text-[#f5a623]">
        Strong H1B
      </span>
    )
  if (confidence >= 60)
    return (
      <span className="border border-[#f5a623]/30 bg-[#f5a623]/12 px-2 py-0.5 text-[11px] font-semibold text-[#f5a623]">
        Likely H1B
      </span>
    )
  return null
}

export default async function PublicCompaniesPage() {
  let companies: Company[] = []
  // Real totals across ALL active companies — NOT companies.length, which is
  // capped at the LIMIT below and made the header read a bogus "500 active
  // companies" that also disagreed with the homepage (T1-09).
  let totals = { companyCount: 0, roleCount: 0 }
  if (hasPostgresEnv()) {
    try {
      const pool = getPostgresPool()
      const [{ rows }, { rows: aggRows }] = await Promise.all([
        pool.query<Company>(
          `SELECT id, name, domain, logo_url, industry, size, job_count, sponsors_h1b, sponsorship_confidence
           FROM companies
           WHERE is_active = true AND job_count > 0
           ORDER BY job_count DESC
           LIMIT 500`
        ),
        pool.query<{ company_count: number; role_count: number }>(
          `SELECT COUNT(*)::int AS company_count,
                  COALESCE(SUM(job_count), 0)::int AS role_count
             FROM companies
            WHERE is_active = true AND job_count > 0`
        ),
      ])
      companies = rows
      totals = {
        companyCount: aggRows[0]?.company_count ?? 0,
        roleCount: aggRows[0]?.role_count ?? 0,
      }
    } catch {
      companies = []
    }
  }

  const grouped = companies.reduce<Record<string, Company[]>>((acc, company) => {
    const industry = company.industry ?? "Other"
    if (!acc[industry]) acc[industry] = []
    acc[industry].push(company)
    return acc
  }, {})

  const groupedEntries = Object.entries(grouped)
    .map(([industry, industryCompanies]) => ({
      industry,
      companies: industryCompanies,
      jobTotal: industryCompanies.reduce((sum, company) => sum + (company.job_count ?? 0), 0),
    }))
    .sort((a, b) => b.jobTotal - a.jobTotal)
    .slice(0, 8)
    .map((group) => ({ ...group, companies: group.companies.slice(0, 9) }))
  const visibleCompanyCount = groupedEntries.reduce((sum, group) => sum + group.companies.length, 0)

  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      {/* Hero — terminal prompt + data status line. */}
      <section className="mx-auto grid w-full max-w-[78rem] gap-6 px-4 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.62fr)] lg:items-end">
        <div>
          <p className="term-label">&gt; company_radar --live</p>
          <h1 className="mt-4 max-w-[34rem] text-[2.4rem] font-semibold leading-[1.02] tracking-tight text-white sm:text-[3.4rem]">
            Companies <span className="text-[#f5a623]">hiring now</span>
            <span className="ml-1 inline-block w-[0.5ch] animate-pulse text-[#38e08a]">_</span>
          </h1>
          <p className="mt-4 max-w-[34rem] text-[14px] leading-relaxed text-[#ccd6cf]/70">
            Browse employers with live roles, sponsorship signals, and career-page freshness from the same market graph powering Hireoven alerts.
          </p>
          <Link href="/signup?next=%2Fdashboard%2Fonboarding" className="term-btn term-btn-amber mt-7">
            Get company alerts <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)]">
          {[
            { value: totals.companyCount.toLocaleString(), label: "active companies", Icon: COMPANY_STAT_ICONS.companies },
            { value: totals.roleCount.toLocaleString(), label: "open roles", Icon: COMPANY_STAT_ICONS.roles },
            { value: "H-1B", label: "sponsor proof", Icon: COMPANY_STAT_ICONS.sponsor },
          ].map(({ value, label, Icon }) => (
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

      <main className="mx-auto w-full max-w-[88rem] px-4 py-12 sm:px-6 lg:px-10">

        {/* Sign-up CTA */}
        <div className="mb-10 flex flex-col items-start justify-between gap-4 term-panel px-6 py-5 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold text-white">Get instant alerts when companies post</p>
            <p className="text-[13px] text-[#ccd6cf]/65 mt-0.5">Free to sign up. No spam.</p>
          </div>
          <Link
            href="/signup?next=%2Fdashboard%2Fonboarding"
            className="term-btn term-btn-amber shrink-0"
          >
            Sign up free →
          </Link>
        </div>

        {/* Company grid by industry */}
        <div className="space-y-12">
          {groupedEntries.map(({ industry, companies: industryCompanies }) => (
            <section key={industry}>
              <h2 className="term-label mb-4">{industry}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {industryCompanies.map((company) => (
                  <Link
                    key={company.id}
                    href={`/companies/${company.id}`}
                    className="group term-panel term-panel-hover flex items-start gap-4 p-4"
                  >
                    <div className="flex-shrink-0">
                      <CompanyLogo
                        companyName={company.name}
                        domain={company.domain}
                        logoUrl={company.logo_url}
                        className="h-12 w-12 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#ccd6cf] transition group-hover:text-white">
                        {company.name}
                      </p>
                      <p className="mt-0.5 text-[13px] text-[#ccd6cf]/55">
                        {company.job_count} open role{company.job_count === 1 ? "" : "s"}
                      </p>
                      {company.sponsorship_confidence >= 60 && (
                        <div className="mt-2">
                          <SponsorsH1BBadge confidence={company.sponsorship_confidence} />
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        {companies.length > visibleCompanyCount && (
          <div className="mt-12 term-panel px-6 py-8 text-center">
            <p className="text-[1.7rem] font-semibold leading-tight tracking-tight text-white">
              Want the full company map?
            </p>
            <p className="mx-auto mt-2 max-w-xl text-[13.5px] leading-relaxed text-[#ccd6cf]/65">
              Sign in to search all {companies.length.toLocaleString()} active companies with filters for role, sponsor signal, location, and freshness.
            </p>
            <Link
              href="/signup?next=%2Fdashboard%2Fonboarding"
              className="term-btn term-btn-amber mt-5"
            >
              Browse the full map <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}
