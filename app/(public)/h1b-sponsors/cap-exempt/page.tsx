import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { CapExemptBadge } from "@/components/h1b/badges/CapExemptBadge"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyParam } from "@/lib/seo/company-seo"

export const revalidate = 86400

export const metadata: Metadata = {
  title: "H-1B Cap-Exempt Employers (No Lottery Required)",
  description:
    "Universities, federal research labs, and affiliated nonprofits that can file H-1B petitions outside the annual lottery cap. A path to status for applicants who lost the lottery.",
  alternates: { canonical: "/h1b-sponsors/cap-exempt" },
}

type Row = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  industry: string | null
  cap_exempt_reason: string
  cap_exempt_confidence: "high" | "medium" | "low"
  h1b_sponsor_count_1yr: number | null
}

const REASONS = [
  { key: "", label: "All" },
  { key: "university", label: "Universities" },
  { key: "govt_research", label: "Federal research" },
  { key: "nonprofit_research", label: "Nonprofit research" },
]

async function getCompanies(reason: string | undefined): Promise<{ rows: Row[]; total: number }> {
  if (!hasPostgresEnv()) return { rows: [], total: 0 }
  const pool = getPostgresPool()
  const params: unknown[] = []
  let where = `WHERE is_cap_exempt = true AND is_active = true
    AND COALESCE(domain, '') NOT ILIKE '%-tenant%'
    AND COALESCE(logo_url, '') NOT ILIKE '%oraclecloud.com%'
    AND lower(name) NOT LIKE '%.oraclecloud.com'`
  if (reason) {
    params.push(reason)
    where += ` AND cap_exempt_reason = $${params.length}`
  }
  const [list, count] = await Promise.all([
    pool.query<Row>(
      `SELECT id, name, domain, logo_url, industry, cap_exempt_reason, cap_exempt_confidence, h1b_sponsor_count_1yr
       FROM companies ${where}
       ORDER BY h1b_sponsor_count_1yr DESC NULLS LAST, job_count DESC NULLS LAST
       LIMIT 100`,
      params
    ),
    pool.query<{ n: string }>(`SELECT COUNT(*)::text n FROM companies ${where}`, params),
  ])
  return { rows: list.rows, total: Number(count.rows[0]?.n ?? 0) }
}

export default async function CapExemptPage({
  searchParams,
}: {
  searchParams: { reason?: string }
}) {
  const reason = REASONS.some((r) => r.key === searchParams.reason && r.key) ? searchParams.reason : undefined
  const { rows, total } = await getCompanies(reason)

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "H-1B Cap-Exempt Employers",
    itemListElement: rows.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: { "@type": "Organization", name: r.name },
    })),
  }

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="term-label">Cap exempt</p>
        <h1 className="mt-4 text-[2.1rem] font-semibold leading-tight tracking-tight text-white sm:text-[2.6rem]">
          H-1B <span className="text-[#f5a623]">Cap-Exempt</span> Employers
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[#ccd6cf]/70">
          Under INA 214(g)(5), universities, government research organizations, and affiliated
          nonprofits can file H-1B petitions <strong className="text-white">outside the annual lottery</strong> — year-round,
          no cap. For applicants who lost the lottery, these employers are a path to status.
        </p>
        <p className="mt-2 text-xs text-[#ccd6cf]/45">
          {total.toLocaleString()} cap-exempt employers ·{" "}
          <Link
            href="/h1b-sponsors/leaderboard/methodology#cap-exempt"
            className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
          >
            Methodology
          </Link>
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {REASONS.map((r) => {
            const active = (reason ?? "") === r.key
            const href = r.key ? `/h1b-sponsors/cap-exempt?reason=${r.key}` : "/h1b-sponsors/cap-exempt"
            return (
              <Link
                key={r.label}
                href={href}
                className={
                  active
                    ? "border border-[#f5a623] bg-[#f5a623] px-3 py-1.5 text-sm font-medium text-[#0a0e0c]"
                    : "border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1.5 text-sm text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]"
                }
              >
                {r.label}
              </Link>
            )
          })}
        </div>

        <ul className="mt-5 space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="term-panel term-panel-hover flex items-center gap-3 p-3"
            >
              <CompanyLogo
                companyName={r.name}
                domain={r.domain}
                logoUrl={r.logo_url}
                className="h-9 w-9 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/h1b-sponsors/${companyParam(r.id, r.name)}`}
                  className="block truncate font-medium text-[#ccd6cf] hover:text-white"
                >
                  {r.name}
                </Link>
                <div className="text-xs text-[#ccd6cf]/45">{r.industry ?? ""}</div>
              </div>
              <span className="shrink-0">
                <CapExemptBadge
                  reason={r.cap_exempt_reason}
                  confidence={r.cap_exempt_confidence}
                  size="sm"
                />
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs text-[#ccd6cf]/45">
          Cap-exempt status here is classified from employer name, domain, and industry. Always
          confirm with the employer before relying on it for a petition.
        </p>
      </main>
    </div>
  )
}
