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
  let where = "WHERE is_cap_exempt = true AND is_active = true"
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
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          H-1B Cap-Exempt Employers
        </h1>
        <p className="mt-2 text-slate-600">
          Under INA 214(g)(5), universities, government research organizations, and affiliated
          nonprofits can file H-1B petitions <strong>outside the annual lottery</strong> — year-round,
          no cap. For applicants who lost the lottery, these employers are a path to status.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {total.toLocaleString()} cap-exempt employers ·{" "}
          <Link href="/h1b-sponsors/leaderboard/methodology#cap-exempt" className="underline">
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
                    ? "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
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
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <CompanyLogo
                companyName={r.name}
                domain={r.domain}
                logoUrl={r.logo_url}
                className="h-9 w-9 shrink-0 rounded-md"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/h1b-sponsors/${companyParam(r.id, r.name)}`}
                  className="truncate font-medium text-slate-900 hover:underline"
                >
                  {r.name}
                </Link>
                <div className="text-xs text-slate-500">{r.industry ?? ""}</div>
              </div>
              <CapExemptBadge
                reason={r.cap_exempt_reason}
                confidence={r.cap_exempt_confidence}
                size="sm"
              />
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs text-slate-400">
          Cap-exempt status here is classified from employer name, domain, and industry. Always
          confirm with the employer before relying on it for a petition.
        </p>
      </main>
    </div>
  )
}
