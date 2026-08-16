import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { EverifyBadge } from "@/components/h1b/badges/EverifyBadge"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyParam } from "@/lib/seo/company-seo"

export const revalidate = 86400

export const metadata: Metadata = {
  title: "E-Verify Employers (Required for STEM OPT)",
  description:
    "Employers enrolled in the federal E-Verify program — a requirement for the 24-month STEM OPT extension. Check any employer in the USCIS E-Verify employer search.",
  alternates: { canonical: "/h1b-sponsors/e-verify" },
}

type Row = { id: string; name: string; domain: string | null; logo_url: string | null; industry: string | null }

async function getEverifyCompanies(): Promise<Row[]> {
  if (!hasPostgresEnv()) return []
  const { rows } = await getPostgresPool().query<Row>(
    `SELECT id, name, domain, logo_url, industry FROM companies
     WHERE is_e_verify = true AND is_active = true
       AND COALESCE(domain, '') NOT ILIKE '%-tenant%'
       AND COALESCE(logo_url, '') NOT ILIKE '%oraclecloud.com%'
       AND lower(name) NOT LIKE '%.oraclecloud.com'
     ORDER BY h1b_sponsor_count_1yr DESC NULLS LAST, job_count DESC NULLS LAST LIMIT 100`
  )
  return rows
}

export default async function EverifyPage() {
  const rows = await getEverifyCompanies()

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="term-label">E verify</p>
        <h1 className="mt-4 text-[2.1rem] font-semibold leading-tight tracking-tight text-white sm:text-[2.6rem]">
          E-Verify <span className="text-[#f5a623]">Employers</span>
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[#ccd6cf]/70">
          The STEM OPT 24-month extension requires that your employer is enrolled in{" "}
          <a
            href="https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-extension-for-stem-students-stem-opt"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
          >
            E-Verify
          </a>
          , the federal employment-eligibility program. Confirm an employer&rsquo;s enrollment before
          accepting an offer you&rsquo;re counting on for STEM OPT.
        </p>

        <div className="term-panel mt-5 p-5 text-sm text-[#ccd6cf]/70">
          <p>
            USCIS publishes E-Verify participation through a daily-updated{" "}
            <a
              href="https://www.e-verify.gov/e-verify-employer-search"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
            >
              employer search tool
            </a>
            , not a bulk download. We surface E-Verify status on employers we&rsquo;ve matched to that
            record; for any employer not listed here, check the official tool directly.
          </p>
          <p className="mt-2">
            <Link
              href="/h1b-sponsors/leaderboard/methodology#e-verify"
              className="text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
            >
              How we source this
            </Link>
          </p>
        </div>

        {rows.length > 0 ? (
          <ul className="mt-5 space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="term-panel term-panel-hover flex items-center gap-3 p-3">
                <CompanyLogo companyName={r.name} domain={r.domain} logoUrl={r.logo_url} className="h-9 w-9 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]" />
                <Link href={`/h1b-sponsors/${companyParam(r.id, r.name)}`} className="min-w-0 flex-1 truncate font-medium text-[#ccd6cf] hover:text-white">
                  {r.name}
                </Link>
                <EverifyBadge size="sm" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 text-sm text-[#ccd6cf]/55">
            Our matched E-Verify list is being compiled. In the meantime, check any employer in the{" "}
            <a href="https://www.e-verify.gov/e-verify-employer-search" target="_blank" rel="noopener noreferrer" className="text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]">
              USCIS E-Verify employer search
            </a>
            .
          </p>
        )}
      </main>
    </div>
  )
}
