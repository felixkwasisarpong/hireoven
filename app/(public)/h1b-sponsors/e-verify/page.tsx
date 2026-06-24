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
     ORDER BY h1b_sponsor_count_1yr DESC NULLS LAST, job_count DESC NULLS LAST LIMIT 100`
  )
  return rows
}

export default async function EverifyPage() {
  const rows = await getEverifyCompanies()

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">E-Verify Employers</h1>
        <p className="mt-2 text-slate-600">
          The STEM OPT 24-month extension requires that your employer is enrolled in{" "}
          <a
            href="https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-extension-for-stem-students-stem-opt"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            E-Verify
          </a>
          , the federal employment-eligibility program. Confirm an employer&rsquo;s enrollment before
          accepting an offer you&rsquo;re counting on for STEM OPT.
        </p>

        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          <p>
            USCIS publishes E-Verify participation through a daily-updated{" "}
            <a
              href="https://www.e-verify.gov/e-verify-employer-search"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-slate-900 underline"
            >
              employer search tool
            </a>
            , not a bulk download. We surface E-Verify status on employers we&rsquo;ve matched to that
            record; for any employer not listed here, check the official tool directly.
          </p>
          <p className="mt-2">
            <Link href="/h1b-sponsors/leaderboard/methodology#e-verify" className="underline">
              How we source this
            </Link>
          </p>
        </div>

        {rows.length > 0 ? (
          <ul className="mt-5 space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                <CompanyLogo companyName={r.name} domain={r.domain} logoUrl={r.logo_url} className="h-9 w-9 shrink-0 rounded-md" />
                <Link href={`/h1b-sponsors/${companyParam(r.id, r.name)}`} className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:underline">
                  {r.name}
                </Link>
                <EverifyBadge size="sm" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 text-sm text-slate-500">
            Our matched E-Verify list is being compiled. In the meantime, check any employer in the{" "}
            <a href="https://www.e-verify.gov/e-verify-employer-search" target="_blank" rel="noopener noreferrer" className="underline">
              USCIS E-Verify employer search
            </a>
            .
          </p>
        )}
      </main>
    </div>
  )
}
