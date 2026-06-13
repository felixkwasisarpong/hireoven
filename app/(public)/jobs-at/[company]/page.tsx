import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, Banknote, MapPin, Briefcase } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { companyIdFromParam, companyParam, salariesPath } from "@/lib/seo/company-seo"

export const dynamic = "force-dynamic"

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

type Props = { params: Promise<{ company: string }> }

type Company = { id: string; name: string; domain: string | null; logo_url: string | null; industry: string | null }
type Job = {
  id: string
  title: string
  location: string | null
  is_remote: boolean | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  first_detected_at: string | null
}
type Data = { company: Company; jobs: Job[]; total: number }

function salaryLabel(j: Job): string | null {
  if (j.salary_min == null && j.salary_max == null) return null
  const sym = !j.salary_currency || j.salary_currency === "USD" ? "$" : ""
  const k = (n: number) => `${sym}${Math.round(n / 1000)}k`
  if (j.salary_min && j.salary_max) return `${k(j.salary_min)}–${k(j.salary_max)}`
  return k((j.salary_min ?? j.salary_max) as number)
}

function freshness(iso: string | null): string {
  if (!iso) return ""
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

async function getData(param: string): Promise<Data | null> {
  if (!hasPostgresEnv()) return null
  const id = companyIdFromParam(param)
  if (!id) return null
  const pool = getPostgresPool()

  const cRes = await pool.query<Company>(
    `SELECT id, name, domain, logo_url, industry FROM companies WHERE id = $1::uuid LIMIT 1`,
    [id],
  )
  const company = cRes.rows[0]
  if (!company) return null

  const where = `company_id = $1::uuid AND is_active = true AND ${sqlPublishedJob("jobs")} AND ${sqlJobLocatedInUsa("jobs")}`
  const [jobsRes, countRes] = await Promise.all([
    pool.query<Job>(
      `SELECT id, title, location, is_remote, salary_min, salary_max, salary_currency, first_detected_at
         FROM jobs WHERE ${where}
        ORDER BY first_detected_at DESC NULLS LAST LIMIT 50`,
      [id],
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM jobs WHERE ${where}`, [id]),
  ])

  const total = countRes.rows[0]?.n ?? 0
  if (total === 0) return null
  return { company, jobs: jobsRes.rows, total }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getData((await params).company)
  if (!d) return { title: "Jobs — Hireoven" }
  return {
    title: `${d.company.name} jobs: ${d.total.toLocaleString()} open roles hiring now — Hireoven`,
    description: `Browse ${d.total.toLocaleString()} open jobs at ${d.company.name} hiring right now in the US — titles, locations, salaries, and freshness. Updated continuously by Hireoven.`,
    alternates: { canonical: `${BASE}/jobs-at/${companyParam(d.company.id, d.company.name)}` },
    openGraph: {
      title: `Jobs at ${d.company.name} hiring now`,
      description: `${d.total.toLocaleString()} open US roles, refreshed continuously.`,
      type: "website",
    },
  }
}

export default async function JobsAtPage({ params }: Props) {
  const d = await getData((await params).company)
  if (!d) notFound()
  const { company, jobs, total } = d

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Jobs at ${company.name}`,
    numberOfItems: total,
    itemListElement: jobs.slice(0, 50).map((j, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: j.title,
      url: `${BASE}/jobs/${j.id}`,
    })),
  }

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <CompanyLogo companyName={company.name} domain={company.domain} logoUrl={company.logo_url} priority className="h-16 w-16 shrink-0 rounded-2xl border border-slate-200/70 bg-white" />
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
              <Briefcase className="h-3.5 w-3.5" /> {total.toLocaleString()} open US roles
            </span>
            <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">Jobs at {company.name} hiring now</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
              {total.toLocaleString()} open roles at {company.name} in the US, refreshed continuously. Set an alert and apply the moment a new one drops.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
              <Link href={salariesPath(company.id, company.name)} className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">What {company.name} pays →</Link>
            </div>
          </div>
        </header>

        <ol className="mt-8 space-y-2">
          {jobs.map((j) => {
            const sal = salaryLabel(j)
            return (
              <li key={j.id}>
                <Link href={`/jobs/${j.id}`} className="block rounded-2xl border border-slate-200 bg-white px-4 py-3.5 transition hover:border-sky-200 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900">{j.title}</p>
                    <span className="shrink-0 text-[12px] text-slate-400">{freshness(j.first_detected_at)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
                    {(j.is_remote || j.location) && (
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{j.is_remote ? "Remote" : j.location}</span>
                    )}
                    {sal && <span className="inline-flex items-center gap-1 font-medium text-slate-600"><Banknote className="h-3.5 w-3.5" />{sal}</span>}
                  </div>
                </Link>
              </li>
            )
          })}
        </ol>

        {total > jobs.length && (
          <div className="mt-6">
            <Link href={`/signup?next=${encodeURIComponent(`/companies/${company.id}`)}`} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
              See all {total.toLocaleString()} roles &amp; set alerts <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-slate-400">
          Live roles from Hireoven&apos;s continuously-updated US job index. Showing the {Math.min(jobs.length, total).toLocaleString()} most recent of {total.toLocaleString()}.
        </p>
      </main>
    </div>
  )
}
