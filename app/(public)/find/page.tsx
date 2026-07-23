import type { Metadata } from "next"
import Link from "next/link"
import { ShieldCheck, Target, CheckCircle2, BellRing } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import LandingJobSearch from "@/components/marketing/LandingJobSearch"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { searchLandingJobs, type LandingJob } from "@/lib/jobs/landing-search"
import { companyParam } from "@/lib/seo/company-seo"

export const revalidate = 300

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
const DEFAULT_QUERY = "software engineer"

export const metadata: Metadata = {
  title: "Every job, sponsorship-checked before you apply — Hireoven",
  description:
    "See which employers have actually filed H-1B petitions, pulled from public DOL and USCIS records. Search real listings with sponsorship badges — free, no account.",
  alternates: { canonical: `${BASE}/find` },
  openGraph: {
    title: "Every job, sponsorship-checked before you apply",
    description: "Search real job listings with H-1B sponsorship badges from public DOL & USCIS data. Free, no account.",
    type: "website",
  },
}

interface ProofCompany {
  id: string
  name: string
  petitions1yr: number
  petitions3yr: number
  industry: string | null
}

async function getData(): Promise<{ initialJobs: LandingJob[]; proof: ProofCompany | null }> {
  if (!hasPostgresEnv()) return { initialJobs: [], proof: null }
  const pool = getPostgresPool()
  const [initialJobs, proofRes] = await Promise.all([
    searchLandingJobs(pool, DEFAULT_QUERY, 8),
    pool
      .query<{ id: string; name: string; c1: number; c3: number; industry: string | null }>(
        `SELECT id, name,
                COALESCE(h1b_sponsor_count_1yr, 0) AS c1,
                COALESCE(h1b_sponsor_count_3yr, 0) AS c3,
                industry
           FROM companies
          WHERE is_active = true AND sponsors_h1b = true AND COALESCE(h1b_sponsor_count_1yr, 0) > 0
          ORDER BY h1b_sponsor_count_1yr DESC NULLS LAST
          LIMIT 1`,
      )
      .catch(() => ({ rows: [] as Array<{ id: string; name: string; c1: number; c3: number; industry: string | null }> })),
  ])
  const p = proofRes.rows[0]
  const proof: ProofCompany | null = p
    ? { id: p.id, name: p.name, petitions1yr: Number(p.c1), petitions3yr: Number(p.c3), industry: p.industry }
    : null
  return { initialJobs, proof }
}

const BENEFITS = [
  {
    Icon: Target,
    title: "Stop wasting applications",
    body: "Filter to employers with real sponsorship history instead of guessing from the job post.",
  },
  {
    Icon: CheckCircle2,
    title: "Know before the final round",
    body: "No more discovering they don't sponsor after four interviews. See the signal up front.",
  },
  {
    Icon: BellRing,
    title: "Get alerted",
    body: "New sponsor-friendly roles in your field, sent to your inbox every week.",
  },
]

export default async function FindPage() {
  const { initialJobs, proof } = await getData()

  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      {/* Hero — terminal prompt + data status line. */}
      <section className="mx-auto w-full max-w-3xl px-4 pt-12 sm:px-6 sm:pt-16">
        <p className="term-label">&gt; sponsorship_intelligence</p>
        <h1 className="mt-4 text-[2.3rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[3.1rem]">
          Every job, <span className="text-[#f5a623]">sponsorship-checked</span> before you apply
          <span className="ml-1 inline-block w-[0.5ch] animate-pulse text-[#38e08a]">_</span>
        </h1>
        <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#ccd6cf]/70">
          See which employers have actually filed H-1B petitions, pulled from public DOL and USCIS records.
          <span className="text-[#38e08a]">{" free // no account"}</span>
        </p>
      </section>

      <section className="mx-auto mt-7 w-full max-w-3xl px-4 sm:px-6">
        <div className="term-panel p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2 border-b border-[rgba(120,200,160,0.12)] pb-2">
            <span className="h-2 w-2 rounded-full bg-[#38e08a]" aria-hidden />
            <span className="term-label">search --live --sponsorship</span>
          </div>
          <LandingJobSearch defaultQuery={DEFAULT_QUERY} initialJobs={initialJobs} />
        </div>
      </section>

      {/* Proof: one real company profile. */}
      {proof && (
        <section className="mx-auto mt-14 w-full max-w-3xl px-4 sm:px-6">
          <p className="term-label mb-3">{"// here's what you see for an employer"}</p>
          <div className="term-panel p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#f5a623]" />
              <p className="text-[17px] font-semibold text-white">{proof.name}</p>
            </div>
            {proof.industry && <p className="mt-0.5 text-[13px] text-[#ccd6cf]/55">{proof.industry}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-4 py-3">
                <p className="text-[26px] font-semibold leading-none tabular-nums text-[#38e08a]">
                  {proof.petitions1yr.toLocaleString()}
                </p>
                <p className="term-label mt-1">certified h-1b · 12 mo</p>
              </div>
              <div className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-4 py-3">
                <p className="text-[26px] font-semibold leading-none tabular-nums text-[#38e08a]">
                  {proof.petitions3yr.toLocaleString()}
                </p>
                <p className="term-label mt-1">over 3 years</p>
              </div>
            </div>
            <Link
              href={`/h1b-sponsors/${companyParam(proof.id, proof.name)}`}
              className="mt-4 inline-block text-[13px] font-semibold text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
            >
              see {proof.name}&apos;s full sponsorship profile →
            </Link>
          </div>
        </section>
      )}

      {/* Three benefits. */}
      <section className="mx-auto mt-14 w-full max-w-3xl px-4 sm:px-6">
        <div className="grid gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-3">
          {BENEFITS.map(({ Icon, title, body }) => (
            <div key={title} className="term-panel-hover bg-[#0e1411] p-5">
              <Icon className="h-5 w-5 text-[#f5a623]" />
              <h3 className="mt-3 text-[14px] font-semibold text-white">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#ccd6cf]/65">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Signup last — unlocking, not gatekeeping. */}
      <section className="mx-auto mt-14 mb-20 w-full max-w-3xl px-4 sm:px-6">
        <div className="term-panel p-6 py-9 text-center sm:px-8">
          <p className="term-label">{"// unlock"}</p>
          <p className="mt-2 text-[1.7rem] font-semibold leading-tight tracking-tight text-white">
            Save searches. Get alerts. <span className="text-[#38e08a]">Free.</span>
          </p>
          <p className="mx-auto mt-3 max-w-md text-[13.5px] leading-relaxed text-[#ccd6cf]/65">
            You&apos;ve already seen the data. Create an account to save this search and get sponsor-friendly roles
            sent to you weekly — no resume or visa details required to start.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/signup?next=%2Fdashboard%2Fonboarding" className="term-btn term-btn-amber w-full justify-center sm:w-auto">
              Continue with Google
            </Link>
            <Link href="/signup?next=%2Fdashboard%2Fonboarding" className="term-btn w-full justify-center sm:w-auto">
              Sign up with email
            </Link>
          </div>
          <p className="term-label mt-4">{"no credit card // historical signals, not guarantees"}</p>
        </div>
      </section>
    </div>
  )
}
