"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Building2, Mail, TrendingDown, TrendingUp, Minus } from "lucide-react"
import CompanyHeader from "@/components/companies/CompanyHeader"
import SimilarCompanies from "@/components/companies/SimilarCompanies"
import SponsorshipScore from "@/components/international/SponsorshipScore"
import JobCard from "@/components/jobs/JobCard"
import { ScoutMiniPanel } from "@/components/scout/ScoutMiniPanel"
import { cn } from "@/lib/utils"
import type { Company, EmployerLCAStats, EmploymentType, H1BRecord, JobWithCompany, SeniorityLevel } from "@/types"

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

function TrendIndicator({ trend }: { trend: string | null }) {
  if (!trend) return null
  const t = trend.toLowerCase()
  if (t.includes("ris") || t.includes("increas") || t === "up")
    return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
  if (t.includes("declin") || t.includes("decreas") || t === "down")
    return <TrendingDown className="h-3.5 w-3.5 text-red-500" />
  return <Minus className="h-3.5 w-3.5 text-gray-400" />
}

export default function CompanyProfilePage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>("roles")

  const [company,     setCompany]     = useState<Company | null>(null)
  const [records,     setRecords]     = useState<H1BRecord[]>([])
  const [lcaStats,    setLcaStats]    = useState<EmployerLCAStats | null>(null)
  const [jobs,        setJobs]        = useState<JobWithCompany[]>([])
  const [newThisWeek, setNewThisWeek] = useState(0)
  const [jdInsights,  setJdInsights]  = useState<JdInsights | null>(null)
  const [isLoading,   setIsLoading]   = useState(true)

  const [senFilter,  setSenFilter]  = useState<SeniorityLevel[]>([])
  const [empFilter,  setEmpFilter]  = useState<EmploymentType[]>([])
  const [remoteOnly, setRemoteOnly] = useState(false)

  useEffect(() => {
    async function load() {
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - 7)

      const [companyRes, h1bRes, jobsRes] = await Promise.all([
        fetch(`/api/companies/${encodeURIComponent(id)}`),
        fetch(`/api/h1b/records?companyId=${encodeURIComponent(id)}&limit=6`),
        fetch(`/api/jobs?company_id=${encodeURIComponent(id)}&limit=50&sort=fresh`),
      ])

      const companyData = companyRes.ok
        ? ((await companyRes.json()) as { company: Company | null; jobs: JobWithCompany[] })
        : null
      const h1bData = h1bRes.ok
        ? ((await h1bRes.json()) as { records: H1BRecord[] }).records
        : []
      const jobsPayload = jobsRes.ok
        ? ((await jobsRes.json()) as { jobs: JobWithCompany[] })
        : { jobs: [] }

      setCompany(companyData?.company ?? null)
      setRecords(h1bData ?? [])
      setLcaStats(null)

      const typedJobs = companyData?.jobs ?? jobsPayload.jobs
      setJobs(typedJobs)
      setNewThisWeek(
        typedJobs.filter((j) => new Date(j.first_detected_at).getTime() >= weekStart.getTime()).length
      )

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

  const filteredJobs = useMemo(
    () =>
      jobs.filter((j) => {
        if (remoteOnly && !j.is_remote) return false
        if (senFilter.length > 0 && !senFilter.includes(j.seniority_level!)) return false
        if (empFilter.length > 0 && !empFilter.includes(j.employment_type!)) return false
        return true
      }),
    [jobs, senFilter, empFilter, remoteOnly]
  )

  const petitionBars = useMemo(
    () =>
      records
        .filter((r) => r.year !== null)
        .map((r) => ({ year: r.year!, approved: r.approved ?? 0, denied: r.denied ?? 0 }))
        .sort((a, b) => a.year - b.year),
    [records]
  )

  const maxPetitions = Math.max(1, ...petitionBars.map((b) => b.approved + b.denied))
  const breakdown    = company ? calcBreakdown(company, records) : null

  // ── Loading skeleton ──────────────────────────────────────
  if (isLoading) {
    return (
      <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">
        <div className="app-shell space-y-0">
          <div className="border-b border-gray-100 bg-white px-5 py-6 sm:px-6">
            <div className="h-4 w-32 animate-pulse rounded-full bg-gray-100" />
            <div className="mt-5 flex gap-4">
              <div className="h-14 w-14 animate-pulse rounded-2xl bg-gray-100" />
              <div className="space-y-2">
                <div className="h-6 w-48 animate-pulse rounded-full bg-gray-100" />
                <div className="h-4 w-32 animate-pulse rounded-full bg-gray-100" />
              </div>
            </div>
          </div>
          <div className="border-b border-gray-100 bg-white px-5">
            <div className="flex gap-6 py-0.5">
              {[140, 120, 80].map((w) => (
                <div key={w} className="h-10 animate-pulse rounded-full bg-gray-100" style={{ width: w }} />
              ))}
            </div>
          </div>
          <div className="p-5 sm:p-6 space-y-4">
            {[280, 340, 220].map((h) => (
              <div key={h} className="animate-pulse rounded-2xl bg-gray-100" style={{ height: h }} />
            ))}
          </div>
        </div>
      </main>
    )
  }

  if (!company) {
    return (
      <main className="app-page flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">Company not found</p>
          <Link
            href="/dashboard/companies"
            className="mt-4 inline-flex items-center gap-2 text-sm text-[#FF5C18] transition hover:text-[#E14F0E]"
          >
            <ArrowLeft className="h-4 w-4" /> Back to companies
          </Link>
        </div>
      </main>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "roles", label: `Open roles${jobs.length > 0 ? ` (${jobs.length})` : ""}` },
    { key: "intel", label: "Sponsorship intel" },
    { key: "about", label: "About" },
  ]

  return (
    <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">
      <div className="app-shell space-y-0 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))]">

        {/* ── Company hero ──────────────────────────────────── */}
        <div className="border-b border-gray-100 bg-white px-5 py-6 sm:px-6">
          <Link
            href="/dashboard/companies"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-400 transition hover:text-gray-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Company Explorer
          </Link>
          <CompanyHeader company={company} newJobsThisWeek={newThisWeek} />
        </div>

        {/* ── Tab nav (underline style) ──────────────────────── */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-5 sm:px-6">
          <div className="flex gap-0">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "relative mr-6 py-3.5 text-sm font-medium transition-colors",
                  tab === key
                    ? "text-gray-950"
                    : "text-gray-400 hover:text-gray-700"
                )}
              >
                {label}
                {tab === key && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[#FF5C18]" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab content ────────────────────────────────────── */}
        <div className="px-5 py-6 sm:px-6">

          {/* ── Open roles ── */}
          {tab === "roles" && (
            <div>
              {/* Filter chips */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRemoteOnly((v) => !v)}
                  className={cn("chip-control", remoteOnly && "chip-control-active")}
                >
                  Remote only
                </button>
                {SENIORITY_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setSenFilter((prev) =>
                        prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                      )
                    }
                    className={cn("chip-control capitalize", senFilter.includes(s) && "chip-control-active")}
                  >
                    {s}
                  </button>
                ))}
                {EMP_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() =>
                      setEmpFilter((prev) =>
                        prev.includes(o.value) ? prev.filter((x) => x !== o.value) : [...prev, o.value]
                      )
                    }
                    className={cn("chip-control", empFilter.includes(o.value) && "chip-control-active")}
                  >
                    {o.label}
                  </button>
                ))}
                {(senFilter.length > 0 || empFilter.length > 0 || remoteOnly) && (
                  <button
                    type="button"
                    onClick={() => { setSenFilter([]); setEmpFilter([]); setRemoteOnly(false) }}
                    className="text-sm text-gray-400 transition hover:text-gray-600"
                  >
                    Clear
                  </button>
                )}
              </div>

              {filteredJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 py-20 text-center">
                  <Building2 className="h-9 w-9 text-gray-300" />
                  <div>
                    <p className="font-semibold text-gray-700">
                      {jobs.length === 0 ? "No open roles right now" : "No roles match your filters"}
                    </p>
                    <p className="mt-1 text-sm text-gray-400">
                      {jobs.length === 0
                        ? "Watch this company to get notified the moment they post."
                        : "Try widening your filters above."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredJobs.map((job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Sponsorship intel ── */}
          {tab === "intel" && (
            <div className="space-y-6">

              {/* Single intel card */}
              <div className="surface-card overflow-hidden">

                {/* Section 1: Verdict */}
                <div className="px-6 py-6">
                  <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                    Sponsorship verdict
                  </p>
                  <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
                    <div>
                      <p className="mb-4 text-sm text-gray-500 leading-6">
                        Score based on USCIS petition history, approval rates, and signals from{" "}
                        {jobs.length} active job description{jobs.length !== 1 ? "s" : ""}.
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
                              <p className="w-48 flex-shrink-0 text-sm text-gray-600">{label}</p>
                              <div className="flex flex-1 items-center gap-3">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                                  <div
                                    className="h-full rounded-full bg-[#FF5C18] transition-all duration-700"
                                    style={{ width: `${(score / max) * 100}%` }}
                                  />
                                </div>
                                <span className="w-10 text-right text-xs font-semibold tabular-nums text-gray-700">
                                  {score}/{max}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-start justify-center lg:justify-end">
                      <SponsorshipScore score={company.sponsorship_confidence} size="lg" />
                    </div>
                  </div>
                </div>

                {/* Section 2: USCIS petition history */}
                <div className="border-t border-gray-100 px-6 py-6">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                    USCIS petition history
                  </p>
                  <p className="mb-5 text-sm text-gray-500">
                    Approved vs. denied petitions by year from USCIS data.
                  </p>
                  {petitionBars.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      No USCIS H-1B data found. This company may file under a different legal name
                      or rarely sponsor.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-3">
                        {petitionBars.map(({ year, approved, denied }) => {
                          const total = approved + denied
                          const rate  = total > 0 ? Math.round((approved / total) * 100) : 0
                          return (
                            <div key={year} className="flex items-center gap-4">
                              <p className="w-12 flex-shrink-0 text-sm font-medium tabular-nums text-gray-500">
                                {year}
                              </p>
                              <div className="flex h-7 flex-1 items-center gap-px overflow-hidden rounded-lg">
                                <div
                                  className="h-full bg-[#FF5C18]"
                                  style={{ width: `${Math.max(2, (approved / maxPetitions) * 100)}%` }}
                                  title={`${approved.toLocaleString()} approved`}
                                />
                                {denied > 0 && (
                                  <div
                                    className="h-full bg-red-300"
                                    style={{ width: `${Math.max(1, (denied / maxPetitions) * 100)}%` }}
                                    title={`${denied.toLocaleString()} denied`}
                                  />
                                )}
                                <div className="h-full flex-1 bg-gray-100" />
                              </div>
                              <div className="w-24 flex-shrink-0 text-right">
                                <p className="text-sm font-semibold tabular-nums text-gray-900">
                                  {total.toLocaleString()}
                                </p>
                                <p className="text-[10px] text-gray-400">{rate}% approved</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#FF5C18]" />
                          Approved
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-300" />
                          Denied
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Section 3: DOL LCA intel */}
                <div className="border-t border-gray-100 px-6 py-6">
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                      H-1B approval intelligence
                    </p>
                    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      DOL LCA
                    </span>
                  </div>
                  <p className="mb-5 text-sm text-gray-500">
                    Based on DOL Labor Condition Application disclosures — filings that precede every H-1B petition.
                  </p>

                  {lcaStats ? (
                    <>
                      {/* Inline stats strip */}
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                        <div>
                          <p className="text-xl font-bold tabular-nums text-gray-900">
                            {lcaStats.total_applications.toLocaleString()}
                          </p>
                          <p className="text-xs text-gray-400">applications</p>
                        </div>
                        <span className="h-6 w-px bg-gray-200" />
                        <div>
                          <p className="text-xl font-bold tabular-nums text-emerald-700">
                            {lcaStats.total_certified.toLocaleString()}
                          </p>
                          <p className="text-xs text-gray-400">certified</p>
                        </div>
                        <span className="h-6 w-px bg-gray-200" />
                        <div>
                          <p className="text-xl font-bold tabular-nums text-red-600">
                            {lcaStats.total_denied.toLocaleString()}
                          </p>
                          <p className="text-xs text-gray-400">denied</p>
                        </div>
                        <span className="h-6 w-px bg-gray-200" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xl font-bold tabular-nums text-gray-900">
                              {lcaStats.certification_rate !== null
                                ? `${Math.round(lcaStats.certification_rate * 100)}%`
                                : "—"}
                            </p>
                            <TrendIndicator trend={lcaStats.approval_trend} />
                          </div>
                          <p className="text-xs text-gray-400">approval rate</p>
                        </div>
                      </div>

                      {/* Flags */}
                      {(lcaStats.is_staffing_firm || lcaStats.is_consulting_firm ||
                        lcaStats.has_high_denial_rate || lcaStats.is_first_time_filer) && (
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {lcaStats.is_staffing_firm && (
                            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">Staffing firm</span>
                          )}
                          {lcaStats.is_consulting_firm && (
                            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">Consulting firm</span>
                          )}
                          {lcaStats.has_high_denial_rate && (
                            <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">High denial rate</span>
                          )}
                          {lcaStats.is_first_time_filer && (
                            <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700">First-time filer</span>
                          )}
                        </div>
                      )}

                      {/* Top roles */}
                      {lcaStats.top_job_titles.length > 0 && (
                        <div className="mt-5">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                            Top sponsored roles
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {lcaStats.top_job_titles.slice(0, 6).map((title, idx) => (
                              <span
                                key={`${title.title}-${idx}`}
                                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs"
                              >
                                <span className="font-medium text-gray-800">{title.title}</span>
                                <span className="tabular-nums text-gray-400">{title.count.toLocaleString()}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Top states */}
                      {lcaStats.top_states.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                            Top worksite states
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {lcaStats.top_states.slice(0, 8).map((s) => (
                              <span
                                key={s.state}
                                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs"
                              >
                                <span className="font-medium text-gray-800">{s.state}</span>
                                <span className="tabular-nums text-gray-400">{s.count.toLocaleString()}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <p className="mt-5 text-[11px] text-gray-400">
                        Statistical signals only — not legal advice. Consult an immigration attorney for case-specific guidance.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">
                      No DOL LCA filings found for {company.name}. They may file under a different legal entity or not sponsor at all.
                    </p>
                  )}
                </div>

                {/* Section 4: JD signal patterns */}
                {jdInsights && jobs.length > 0 && (
                  <div className="border-t border-gray-100 px-6 py-6">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                      Job description signals
                    </p>
                    <p className="mb-5 text-sm text-gray-500">
                      Sponsorship language detected across {jobs.length} active posting{jobs.length !== 1 ? "s" : ""}.
                    </p>

                    {/* Inline signal strip */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                      {[
                        { label: "Sponsor-positive", count: jdInsights.sponsors, color: "text-emerald-700", dot: "bg-emerald-500" },
                        { label: "No sponsorship",   count: jdInsights.denies,   color: "text-red-600",    dot: "bg-red-400"     },
                        { label: "Neutral / no mention", count: jdInsights.neutral, color: "text-gray-500",  dot: "bg-gray-300"    },
                      ].map(({ label, count, color, dot }) => (
                        <div key={label} className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full flex-shrink-0", dot)} />
                          <span className={cn("text-xl font-bold tabular-nums", color)}>{count}</span>
                          <span className="text-xs text-gray-400">{label}</span>
                        </div>
                      ))}
                    </div>

                    {/* Progress bar */}
                    <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-gray-100">
                      {jobs.length > 0 && (
                        <>
                          <div className="bg-emerald-500 transition-all" style={{ width: `${(jdInsights.sponsors / jobs.length) * 100}%` }} />
                          <div className="bg-red-400 transition-all" style={{ width: `${(jdInsights.denies / jobs.length) * 100}%` }} />
                          <div className="flex-1 bg-gray-200" />
                        </>
                      )}
                    </div>

                    {/* Detected quotes */}
                    {jdInsights.quotes.length > 0 && (
                      <div className="mt-5 space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                          Detected language
                        </p>
                        {jdInsights.quotes.map((q, i) => (
                          <p
                            key={i}
                            className="rounded-xl border-l-2 border-[#FF5C18]/30 bg-orange-50/50 px-4 py-3 text-sm italic text-gray-600"
                          >
                            &ldquo;{q}&rdquo;
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Similar companies */}
              <div>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                  Similar companies that actively sponsor
                </p>
                <SimilarCompanies companyId={id} industry={company.industry} limit={4} />
              </div>
            </div>
          )}

          {/* ── About ── */}
          {tab === "about" && (
            <div className="space-y-6 max-w-2xl">
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/40 px-5 py-6 text-center">
                <p className="text-sm text-gray-400">
                  Company description coming soon — profile enrichment is in progress.
                </p>
              </div>

              {/* Meta fields */}
              {[
                { label: "Industry",     value: company.industry },
                { label: "Size",         value: company.size },
                { label: "Career system", value: company.ats_type
                    ? `${company.ats_type.charAt(0).toUpperCase() + company.ats_type.slice(1)} ATS`
                    : null },
              ].filter((r) => r.value).length > 0 && (
                <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100">
                  {[
                    { label: "Industry",     value: company.industry },
                    { label: "Size",         value: company.size },
                    { label: "Career system", value: company.ats_type
                        ? `${company.ats_type.charAt(0).toUpperCase() + company.ats_type.slice(1)} ATS`
                        : null },
                  ]
                    .filter((r) => r.value)
                    .map(({ label, value }) => (
                      <div key={label} className="flex items-center gap-4 px-5 py-3.5">
                        <p className="w-32 flex-shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                          {label}
                        </p>
                        <p className="text-sm font-medium capitalize text-gray-800">{value}</p>
                      </div>
                    ))}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                {company.careers_url && (
                  <a
                    href={company.careers_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-[#FF5C18] hover:text-[#FF5C18]"
                  >
                    View careers page →
                  </a>
                )}
                <a
                  href={`mailto:hello@hireoven.com?subject=Correction for ${encodeURIComponent(company.name)}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 transition hover:bg-gray-50"
                >
                  <Mail className="h-4 w-4" />
                  Suggest a correction
                </a>
              </div>
            </div>
          )}
        </div>

        <div aria-hidden className="h-[clamp(3rem,10vh,6rem)] shrink-0" />
      </div>

      <ScoutMiniPanel
        pagePath={`/dashboard/companies/${id}`}
        companyId={id}
        suggestionChips={["Is this company worth targeting?"]}
      />
    </main>
  )
}
