"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Building2, Mail } from "lucide-react"
import CompanyHeader from "@/components/companies/CompanyHeader"
import SimilarCompanies from "@/components/companies/SimilarCompanies"
import SponsorshipScore from "@/components/international/SponsorshipScore"
import JobCard from "@/components/jobs/JobCard"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import type { Company, EmploymentType, H1BRecord, JobWithCompany, SeniorityLevel } from "@/types"

type Tab = "roles" | "intel" | "about"

const SENIORITY_OPTIONS: SeniorityLevel[] = ["intern", "junior", "mid", "senior", "staff", "principal"]
const EMP_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: "fulltime",   label: "Full-time"  },
  { value: "parttime",   label: "Part-time"  },
  { value: "contract",   label: "Contract"   },
  { value: "internship", label: "Internship" },
]

type JdInsights = { sponsors: number; denies: number; neutral: number; quotes: string[] }

function calcBreakdown(company: Company, records: H1BRecord[]) {
  const hasPetitions = company.h1b_sponsor_count_1yr > 0
  const approvedRec  = records.reduce((sum, r) => sum + (r.approved ?? 0), 0)
  const totalRec     = records.reduce((sum, r) => sum + ((r.approved ?? 0) + (r.denied ?? 0)), 0)
  const approvalRate = totalRec > 0 ? approvedRec / totalRec : 0

  let petitionScore = 0
  if (company.h1b_sponsor_count_1yr > 50) petitionScore = 50
  else if (company.h1b_sponsor_count_1yr > 10) petitionScore = 40
  else if (company.h1b_sponsor_count_1yr > 0)  petitionScore = 30

  const activityScore = company.h1b_sponsor_count_3yr > 0 ? 20 : 0
  const rateScore     = approvalRate > 0.8 ? 10 : approvalRate > 0.5 ? 5 : 0
  const jdScore       = company.sponsors_h1b ? 20 : 0

  return { petitionScore, activityScore, rateScore, jdScore, approvalRate }
}

export default function CompanyProfilePage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>("roles")

  const [company,      setCompany]      = useState<Company | null>(null)
  const [records,      setRecords]      = useState<H1BRecord[]>([])
  const [jobs,         setJobs]         = useState<JobWithCompany[]>([])
  const [newThisWeek,  setNewThisWeek]  = useState(0)
  const [jdInsights,   setJdInsights]   = useState<JdInsights | null>(null)
  const [isLoading,    setIsLoading]    = useState(true)

  // Job filters (local, not URL — scoped to this page)
  const [senFilter, setSenFilter] = useState<SeniorityLevel[]>([])
  const [empFilter, setEmpFilter] = useState<EmploymentType[]>([])
  const [remoteOnly, setRemoteOnly] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7)

      const [
        { data: companyData },
        { data: h1bData },
        { data: jobsData },
        { count: weekCount },
      ] = await Promise.all([
        supabase.from("companies").select("*").eq("id", id).single(),
        supabase.from("h1b_records").select("*").eq("company_id", id)
          .order("year", { ascending: false }).limit(6),
        supabase.from("jobs")
          .select("*, company:companies(*)")
          .eq("company_id", id).eq("is_active", true)
          .order("first_detected_at", { ascending: false })
          .limit(50),
        supabase.from("jobs").select("*", { head: true, count: "exact" })
          .eq("company_id", id).eq("is_active", true)
          .gte("first_detected_at", weekStart.toISOString()),
      ])

      setCompany(companyData as Company | null)
      setRecords((h1bData as H1BRecord[]) ?? [])

      const typedJobs = (jobsData as JobWithCompany[]) ?? []
      setJobs(typedJobs)
      setNewThisWeek(weekCount ?? 0)

      // JD insights
      const sponsors = typedJobs.filter((j) => j.sponsors_h1b === true).length
      const denies   = typedJobs.filter((j) => j.requires_authorization).length
      const neutral  = typedJobs.length - sponsors - denies
      const quotes   = typedJobs
        .map((j) => j.visa_language_detected)
        .filter((q): q is string => Boolean(q))
        .slice(0, 3)
      setJdInsights({ sponsors, denies, neutral, quotes })

      setIsLoading(false)
    }

    void load()
  }, [id])

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (remoteOnly && !j.is_remote) return false
      if (senFilter.length > 0 && !senFilter.includes(j.seniority_level!)) return false
      if (empFilter.length > 0 && !empFilter.includes(j.employment_type!)) return false
      return true
    })
  }, [jobs, senFilter, empFilter, remoteOnly])

  const petitionBars = useMemo(() => {
    return records
      .filter((r) => r.year !== null)
      .map((r) => ({ year: r.year!, approved: r.approved ?? 0, denied: r.denied ?? 0 }))
      .sort((a, b) => a.year - b.year)
  }, [records])

  const maxPetitions = Math.max(1, ...petitionBars.map((b) => b.approved + b.denied))
  const breakdown    = company ? calcBreakdown(company, records) : null

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_58%)] px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="h-52 animate-pulse rounded-[32px] bg-white/80" />
          <div className="h-12 animate-pulse rounded-2xl bg-white/80" />
          <div className="h-96 animate-pulse rounded-[28px] bg-white/80" />
        </div>
      </main>
    )
  }

  if (!company) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F7FBFF] px-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">Company not found</p>
          <Link href="/dashboard/companies" className="mt-4 inline-flex items-center gap-2 text-sm text-[#0369A1] hover:text-[#075985]">
            <ArrowLeft className="h-4 w-4" /> Back to companies
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_58%,#F8FAFC_100%)] px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">

        {/* Header card */}
        <section className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <Link href="/dashboard/companies" className="mb-5 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition">
            <ArrowLeft className="h-4 w-4" /> Company Explorer
          </Link>
          <CompanyHeader company={company} newJobsThisWeek={newThisWeek} />
        </section>

        {/* Tab nav */}
        <div className="flex gap-1 rounded-2xl border border-gray-200 bg-white p-1">
          {([
            { key: "roles" as Tab, label: `Open roles (${jobs.length})` },
            { key: "intel" as Tab, label: "Sponsorship intel" },
            { key: "about" as Tab, label: "About" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex-1 rounded-xl py-2.5 text-sm font-medium transition",
                tab === key
                  ? "bg-[#0369A1] text-white"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab 1: Open roles ── */}
        {tab === "roles" && (
          <section className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            {/* Filters */}
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRemoteOnly((v) => !v)}
                className={cn(
                  "rounded-xl border px-3 py-1.5 text-sm font-medium transition",
                  remoteOnly ? "border-[#0369A1] bg-[#E0F2FE] text-[#0369A1]" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                )}
              >
                Remote only
              </button>
              {SENIORITY_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    setSenFilter((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
                  }
                  className={cn(
                    "rounded-xl border px-3 py-1.5 text-sm font-medium transition capitalize",
                    senFilter.includes(s) ? "border-[#0369A1] bg-[#E0F2FE] text-[#0369A1]" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  )}
                >
                  {s}
                </button>
              ))}
              {EMP_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() =>
                    setEmpFilter((prev) => prev.includes(o.value) ? prev.filter((x) => x !== o.value) : [...prev, o.value])
                  }
                  className={cn(
                    "rounded-xl border px-3 py-1.5 text-sm font-medium transition",
                    empFilter.includes(o.value) ? "border-[#0369A1] bg-[#E0F2FE] text-[#0369A1]" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  )}
                >
                  {o.label}
                </button>
              ))}
              {(senFilter.length > 0 || empFilter.length > 0 || remoteOnly) && (
                <button
                  type="button"
                  onClick={() => { setSenFilter([]); setEmpFilter([]); setRemoteOnly(false) }}
                  className="text-sm text-gray-400 hover:text-gray-600 transition"
                >
                  Clear
                </button>
              )}
            </div>

            {filteredJobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 px-8 py-12 text-center">
                {jobs.length === 0 ? (
                  <>
                    <Building2 className="mx-auto h-10 w-10 text-gray-300 mb-3" />
                    <p className="font-semibold text-gray-700">No open roles right now</p>
                    <p className="mt-2 text-sm text-gray-400">
                      Watch this company to get notified the moment they post.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">No roles match your filters — try widening them.</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredJobs.map((job) => <JobCard key={job.id} job={job} />)}
              </div>
            )}
          </section>
        )}

        {/* ── Tab 2: Sponsorship intel ── */}
        {tab === "intel" && (
          <div className="space-y-5">
            {/* Section A — Verdict */}
            <section className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Sponsorship verdict</h2>
              <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
                <div>
                  <p className="mb-4 text-sm text-gray-500">
                    This score is calculated from USCIS petition history, approval rates, and
                    signals detected in {jobs.length} active job description{jobs.length !== 1 ? "s" : ""}.
                  </p>
                  {breakdown && (
                    <div className="space-y-3">
                      {[
                        { label: "USCIS petition history", score: breakdown.petitionScore, max: 50 },
                        { label: "Recent petition activity", score: breakdown.activityScore, max: 20 },
                        { label: "H-1B approval rate", score: breakdown.rateScore, max: 10 },
                        { label: "Job description language", score: breakdown.jdScore, max: 20 },
                      ].map(({ label, score, max }) => (
                        <div key={label} className="flex items-center gap-4">
                          <p className="w-52 flex-shrink-0 text-sm text-gray-600">{label}</p>
                          <div className="flex flex-1 items-center gap-3">
                            <div className="flex-1 h-3 overflow-hidden rounded-full bg-gray-100">
                              <div
                                className="h-full rounded-full bg-[#0369A1] transition-all duration-700"
                                style={{ width: `${(score / max) * 100}%` }}
                              />
                            </div>
                            <span className="w-12 text-right text-sm font-semibold tabular-nums text-gray-900">
                              +{score}/{max}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <SponsorshipScore score={company.sponsorship_confidence} size="lg" />
                </div>
              </div>
            </section>

            {/* Section B — USCIS petition history */}
            <section className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
              <h2 className="mb-1 text-lg font-semibold text-gray-900">USCIS petition history</h2>
              <p className="mb-5 text-sm text-gray-500">Approved vs. denied petitions by year from USCIS data.</p>
              {petitionBars.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-gray-200 px-5 py-8 text-center text-sm text-gray-400">
                  No USCIS H-1B data found for this company. This may mean they rarely sponsor
                  or file under a different legal name.
                </p>
              ) : (
                <>
                  <div className="space-y-4">
                    {petitionBars.map(({ year, approved, denied }) => {
                      const total = approved + denied
                      const rate  = total > 0 ? Math.round((approved / total) * 100) : 0
                      return (
                        <div key={year} className="flex items-center gap-4">
                          <p className="w-14 flex-shrink-0 text-sm font-medium text-gray-500">{year}</p>
                          <div className="flex flex-1 h-9 items-center gap-0.5">
                            <div
                              className="h-full rounded-l-xl bg-[#0369A1]"
                              style={{ width: `${Math.max(2, (approved / maxPetitions) * 100)}%` }}
                              title={`${approved.toLocaleString()} approved`}
                            />
                            {denied > 0 && (
                              <div
                                className="h-full rounded-r-xl bg-red-300"
                                style={{ width: `${Math.max(1, (denied / maxPetitions) * 100)}%` }}
                                title={`${denied.toLocaleString()} denied`}
                              />
                            )}
                          </div>
                          <div className="w-28 flex-shrink-0 text-right">
                            <p className="text-sm font-semibold tabular-nums text-gray-900">{total.toLocaleString()}</p>
                            <p className="text-xs text-gray-400">{rate}% approved</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-[#0369A1]" />Approved</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-red-300" />Denied</span>
                  </div>
                </>
              )}
            </section>

            {/* Section C — JD patterns */}
            {jdInsights && jobs.length > 0 && (
              <section className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
                <h2 className="mb-1 text-lg font-semibold text-gray-900">Job description patterns</h2>
                <p className="mb-5 text-sm text-gray-500">
                  Based on {jobs.length} active job posting{jobs.length !== 1 ? "s" : ""} at {company.name}.
                </p>
                <div className="grid gap-3 sm:grid-cols-3 mb-5">
                  {[
                    { label: "Sponsor-positive",   count: jdInsights.sponsors, color: "bg-emerald-500" },
                    { label: "No sponsorship",      count: jdInsights.denies,   color: "bg-red-400"     },
                    { label: "No mention (neutral)",count: jdInsights.neutral,  color: "bg-gray-300"    },
                  ].map(({ label, count, color }) => (
                    <div key={label} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center">
                      <p className="text-2xl font-bold tabular-nums text-gray-900">{count}</p>
                      <p className="text-xs text-gray-500 mt-1">{label}</p>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <div className={`h-full rounded-full ${color}`}
                          style={{ width: jobs.length > 0 ? `${(count / jobs.length) * 100}%` : "0%" }} />
                      </div>
                    </div>
                  ))}
                </div>
                {jdInsights.quotes.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">Detected language</p>
                    {jdInsights.quotes.map((q, i) => (
                      <p key={i} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600 italic">
                        &ldquo;{q}&rdquo;
                      </p>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Section D — Similar companies */}
            <section className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
              <h2 className="mb-1 text-lg font-semibold text-gray-900">
                Companies like {company.name} that actively sponsor
              </h2>
              <p className="mb-4 text-sm text-gray-500">
                Similar {company.industry ?? "technology"} companies with high sponsorship scores.
              </p>
              <SimilarCompanies companyId={id} industry={company.industry} limit={4} />
            </section>
          </div>
        )}

        {/* ── Tab 3: About ── */}
        {tab === "about" && (
          <section className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">About {company.name}</h2>
            <div className="space-y-5">
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
                <p className="text-sm text-gray-400">
                  Company description coming soon. We&apos;re building out profile enrichment — check back.
                </p>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Industry",  value: company.industry   },
                  { label: "Size",      value: company.size       },
                  { label: "Career system", value: company.ats_type
                      ? `Powered by ${company.ats_type.charAt(0).toUpperCase() + company.ats_type.slice(1)}`
                      : null },
                ].filter((r) => r.value).map(({ label, value }) => (
                  <div key={label} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                    <dt className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">{label}</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-800 capitalize">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-3">
                {company.careers_url && (
                  <a
                    href={company.careers_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-[#0369A1] hover:text-[#0369A1]"
                  >
                    View careers page →
                  </a>
                )}
                <a
                  href={`mailto:hello@hireoven.com?subject=Correction for ${encodeURIComponent(company.name)}`}
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 transition hover:bg-gray-50"
                >
                  <Mail className="h-4 w-4" />
                  Suggest a correction
                </a>
              </div>
            </div>
          </section>
        )}

      </div>
    </main>
  )
}
