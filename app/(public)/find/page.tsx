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
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />

      {/* Above the fold: headline + live search, nothing else. */}
      <section className="mx-auto w-full max-w-4xl px-4 pt-10 sm:px-6 sm:pt-14">
        <h1 className="text-center text-[30px] font-black leading-[1.1] tracking-tight text-slate-950 sm:text-[40px]">
          Every job, sponsorship-checked before you apply.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-center text-[16px] leading-relaxed text-slate-600">
          See which employers have actually filed H-1B petitions, pulled from public DOL and USCIS records.{" "}
          <span className="font-semibold text-slate-800">Free.</span>
        </p>

        <div className="mt-7">
          <LandingJobSearch defaultQuery={DEFAULT_QUERY} initialJobs={initialJobs} />
        </div>
      </section>

      {/* Proof: one real company profile. */}
      {proof && (
        <section className="mx-auto mt-16 w-full max-w-4xl px-4 sm:px-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Here&apos;s what you see for an employer
          </h2>
          <div className="mt-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <p className="text-[18px] font-bold text-slate-900">{proof.name}</p>
            </div>
            {proof.industry && <p className="mt-0.5 text-[13px] text-slate-500">{proof.industry}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[24px] font-bold tabular-nums text-slate-900">
                  {proof.petitions1yr.toLocaleString()}
                </p>
                <p className="text-[12px] text-slate-500">certified H-1B petitions · last 12 mo</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[24px] font-bold tabular-nums text-slate-900">
                  {proof.petitions3yr.toLocaleString()}
                </p>
                <p className="text-[12px] text-slate-500">over the last 3 years</p>
              </div>
            </div>
            <Link
              href={`/h1b-sponsors/${companyParam(proof.id, proof.name)}`}
              className="mt-4 inline-block text-[13px] font-semibold text-emerald-700 underline-offset-2 hover:underline"
            >
              See {proof.name}&apos;s full sponsorship profile →
            </Link>
          </div>
        </section>
      )}

      {/* Three benefits. */}
      <section className="mx-auto mt-16 w-full max-w-4xl px-4 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {BENEFITS.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <Icon className="h-6 w-6 text-emerald-600" />
              <h3 className="mt-3 text-[15px] font-bold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Signup last — unlocking, not gatekeeping. */}
      <section className="mx-auto mt-16 mb-20 w-full max-w-3xl px-4 sm:px-6">
        <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-6 py-9 text-center">
          <h2 className="text-[22px] font-bold text-slate-900">Save searches and get alerts. Free.</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-slate-600">
            You&apos;ve already seen the data. Create an account to save this search and get sponsor-friendly roles
            sent to you weekly — no resume or visa details required to start.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-7 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-700 sm:w-auto"
            >
              Continue with Google
            </Link>
            <Link
              href="/signup"
              className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 bg-white px-7 py-3 text-[15px] font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto"
            >
              Sign up with email
            </Link>
          </div>
          <p className="mt-4 text-[12px] text-slate-400">No credit card. Historical signals, not guarantees.</p>
        </div>
      </section>
    </div>
  )
}
