"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Building2,
  Mail,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import CompanyHeader from "@/components/companies/CompanyHeader"
import SimilarCompanies from "@/components/companies/SimilarCompanies"
import { EmployerHealthScore } from "@/components/employers/EmployerHealthScore"
import { SponsorshipTruthScore } from "@/components/employers/SponsorshipTruthScore"
import { ScoutMiniPanel } from "@/components/scout/ScoutMiniPanel"
import {
  JOB_APPLICATION_SAVED_EVENT,
  fetchJobSavedState,
  saveJobToPipeline,
} from "@/lib/applications/save-job-client"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"
import type {
  Company,
  EmployerLCAStats,
  EmploymentType,
  H1BRecord,
  JobWithCompany,
  SeniorityLevel,
} from "@/types"

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

function relativeTime(ts: string) {
  const m = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 60_000))
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function TrendIcon({ trend }: { trend: string | null }) {
  if (!trend) return null
  const t = trend.toLowerCase()
  if (t.includes("ris") || t === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
  if (t.includes("declin") || t === "down") return <TrendingDown className="h-3.5 w-3.5 text-red-500" />
  return <Minus className="h-3.5 w-3.5 text-gray-400" />
}

// ── Compact job row (scoped to company profile — company already known) ──────
function CompactJobRow({ job }: { job: JobWithCompany }) {
  const { pushToast } = useToast()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const title = job.title ?? "Untitled Role"

  const tags: { label: string; accent?: boolean }[] = []
  if (job.is_remote) tags.push({ label: "Remote", accent: true })
  if (job.location?.trim() && !job.is_remote) tags.push({ label: job.location.trim() })
  if (job.seniority_level) tags.push({ label: job.seniority_level })
  if (job.employment_type && job.employment_type !== "fulltime")
    tags.push({ label: job.employment_type === "parttime" ? "Part-time" : job.employment_type })

  useEffect(() => {
    let cancelled = false
    void fetchJobSavedState(job.id).then((s) => { if (!cancelled) setSaved(s) })
    return () => { cancelled = true }
  }, [job.id])

  useEffect(() => {
    function onSync(e: Event) {
      if ((e as CustomEvent<{ jobId?: string }>).detail?.jobId === job.id) setSaved(true)
    }
    window.addEventListener(JOB_APPLICATION_SAVED_EVENT, onSync as EventListener)
    return () => window.removeEventListener(JOB_APPLICATION_SAVED_EVENT, onSync as EventListener)
  }, [job.id])

  async function handleSave(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (saving || saved) return
    setSaving(true)
    try {
      const result = await saveJobToPipeline({
        jobId: job.id,
        companyName: job.company?.name ?? "",
        companyLogoUrl: job.company?.logo_url ?? null,
        jobTitle: title,
        applyUrl: job.apply_url,
        matchScore: null,
        source: "hireoven_feed",
      })
      if (!result.ok) {
        pushToast({ tone: "error", title: "Save failed", description: result.message })
        return
      }
      setSaved(true)
      window.dispatchEvent(new CustomEvent(JOB_APPLICATION_SAVED_EVENT, { detail: { jobId: job.id } }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Link
      href={`/dashboard/jobs/${job.id}`}
      className="group flex items-center gap-4 py-4 transition-colors hover:bg-orange-50/30"
    >
      {/* Title + tags */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900 transition-colors group-hover:text-[#FF5C18]">
          {title}
        </p>
        {tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {tags.map(({ label, accent }) => (
              <span
                key={label}
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                  accent
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-gray-100 text-gray-500"
                )}
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right: signals + time + actions */}
      <div className="flex flex-shrink-0 items-center gap-3">
        {job.sponsors_h1b && (
          <span className="hidden text-[11px] font-semibold text-emerald-700 sm:inline">
            H-1B ✓
          </span>
        )}
        <span className="hidden text-[11px] text-gray-400 sm:inline">
          {relativeTime(job.first_detected_at)}
        </span>

        <button
          type="button"
          onClick={(e) => void handleSave(e)}
          disabled={saving}
          aria-label={saved ? "Saved" : "Save job"}
          className={cn(
            "rounded-lg p-1.5 transition",
            saved
              ? "text-amber-500"
              : "text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-600"
          )}
        >
          {saved ? (
            <BookmarkCheck className="h-4 w-4" />
          ) : (
            <Bookmark className="h-4 w-4" />
          )}
        </button>

        <a
          href={job.apply_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-xl bg-[#FF5C18] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(255,92,24,0.2)] transition hover:bg-[#E14F0E]"
        >
          Apply
          <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>
    </Link>
  )
}

// ── Sponsorship score display (no bordered box) ───────────────────────────────
function ScoreDisplay({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  const tier =
    pct >= 81 ? "Actively sponsors" :
    pct >= 61 ? "Often sponsors" :
    pct >= 31 ? "Sometimes sponsors" :
    "Rarely sponsors"
  const color =
    pct >= 81 ? "text-[#FF5C18]" :
    pct >= 61 ? "text-orange-500" :
    pct >= 31 ? "text-amber-600" :
    "text-red-500"
  const bar =
    pct >= 81 ? "bg-[#FF5C18]" :
    pct >= 61 ? "bg-orange-400" :
    pct >= 31 ? "bg-amber-400" :
    "bg-red-400"

  return (
    <div className="flex flex-col items-center text-center">
      <p className={cn("text-[3.5rem] font-extrabold leading-none tabular-nums", color)}>{pct}</p>
      <p className={cn("mt-2 text-sm font-semibold", color)}>{tier}</p>
      <div className="mt-3 h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
        <div className={cn("h-full rounded-full transition-all duration-700", bar)} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-gray-400">Sponsor confidence score</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // ── Loading ────────────────────────────────────────────────────────────────
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
          <div className="border-b border-gray-100 bg-white px-5 py-3">
            <div className="h-9 w-72 animate-pulse rounded-2xl bg-gray-100" />
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

  return (
    <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">
      <div className="app-shell space-y-0 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))]">

        {/* ── Hero ──────────────────────────────────────────── */}
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

        {/* ── Tab nav ───────────────────────────────────────── */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-5 py-3 backdrop-blur-sm sm:px-6">
          <div className="inline-flex items-center gap-0.5 rounded-2xl bg-gray-100 p-1">
            {(["roles", "intel", "about"] as Tab[]).map((key) => {
              const isActive = tab === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-150",
                    isActive
                      ? "bg-white text-gray-900 shadow-[0_1px_4px_rgba(15,23,42,0.12),0_0_0_1px_rgba(15,23,42,0.04)]"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  {key === "roles" && "Open roles"}
                  {key === "intel" && "Sponsorship intel"}
                  {key === "about" && "About"}
                  {key === "roles" && jobs.length > 0 && (
                    <span
                      className={cn(
                        "inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums transition-colors",
                        isActive ? "bg-[#FF5C18] text-white" : "bg-gray-200 text-gray-500"
                      )}
                    >
                      {jobs.length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Content ───────────────────────────────────────── */}
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
                      setSenFilter((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s])
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
                      setEmpFilter((p) =>
                        p.includes(o.value) ? p.filter((x) => x !== o.value) : [...p, o.value]
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

              {/* Job list */}
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
                <div className="surface-card overflow-hidden px-5">
                  {/* Column headers */}
                  <div className="hidden items-center border-b border-gray-100 py-2.5 sm:flex">
                    <p className="flex-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                      Role
                    </p>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                      {filteredJobs.length} result{filteredJobs.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {filteredJobs.map((job) => (
                      <CompactJobRow key={job.id} job={job} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Sponsorship intel ── */}
          {tab === "intel" && (
            <div className="space-y-6">
              <div className="surface-card overflow-hidden">

                {/* 1. Verdict */}
                <div className="px-6 py-6">
                  <p className="mb-5 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                    Sponsorship verdict
                  </p>
                  <div className="grid gap-8 lg:grid-cols-[1fr_180px]">
                    <div>
                      <p className="mb-5 text-sm leading-6 text-gray-500">
                        Score based on USCIS petition history, approval rates, and signals from{" "}
                        {jobs.length} active job description{jobs.length !== 1 ? "s" : ""}.
                      </p>
                      {breakdown && (
                        <div className="space-y-3.5">
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
                                <span className="w-10 text-right text-xs font-semibold tabular-nums text-gray-600">
                                  {score}/{max}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Score: big number, no box */}
                    <div className="flex items-center justify-center lg:justify-end">
                      <ScoreDisplay score={company.sponsorship_confidence} />
                    </div>
                  </div>
                </div>

                {/* 2. USCIS petition history */}
                <div className="border-t border-gray-100 px-6 py-6">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                    USCIS petition history
                  </p>
                  <p className="mb-5 text-sm text-gray-500">
                    Approved vs. denied petitions by year.
                  </p>
                  {petitionBars.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      No USCIS H-1B data found. This company may file under a different legal name.
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
                              <div className="flex h-7 flex-1 items-center overflow-hidden rounded-lg bg-gray-100">
                                <div
                                  className="h-full bg-[#FF5C18] transition-all duration-700"
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
                          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#FF5C18]" />Approved
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-300" />Denied
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* 3. DOL LCA */}
                <div className="border-t border-gray-100 px-6 py-6">
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                      H-1B approval intelligence
                    </p>
                    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      DOL LCA
                    </span>
                  </div>
                  <p className="mb-5 text-sm text-gray-500">
                    Based on DOL Labor Condition Application disclosures.
                  </p>

                  {lcaStats ? (
                    <>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                        {[
                          { label: "applications", value: lcaStats.total_applications.toLocaleString(), color: "text-gray-900" },
                          { label: "certified",    value: lcaStats.total_certified.toLocaleString(),    color: "text-emerald-700" },
                          { label: "denied",       value: lcaStats.total_denied.toLocaleString(),       color: "text-red-600" },
                        ].map(({ label, value, color }) => (
                          <div key={label}>
                            <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
                            <p className="text-xs text-gray-400">{label}</p>
                          </div>
                        ))}
                        <span className="h-6 w-px bg-gray-200" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xl font-bold tabular-nums text-gray-900">
                              {lcaStats.certification_rate !== null
                                ? `${Math.round(lcaStats.certification_rate * 100)}%`
                                : "—"}
                            </p>
                            <TrendIcon trend={lcaStats.approval_trend} />
                          </div>
                          <p className="text-xs text-gray-400">approval rate</p>
                        </div>
                      </div>

                      {(lcaStats.is_staffing_firm || lcaStats.is_consulting_firm ||
                        lcaStats.has_high_denial_rate || lcaStats.is_first_time_filer) && (
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {lcaStats.is_staffing_firm && <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">Staffing firm</span>}
                          {lcaStats.is_consulting_firm && <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">Consulting firm</span>}
                          {lcaStats.has_high_denial_rate && <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">High denial rate</span>}
                          {lcaStats.is_first_time_filer && <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700">New filer</span>}
                        </div>
                      )}

                      {lcaStats.top_job_titles.length > 0 && (
                        <div className="mt-5">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Top sponsored roles</p>
                          <div className="flex flex-wrap gap-1.5">
                            {lcaStats.top_job_titles.slice(0, 6).map((t, i) => (
                              <span key={`${t.title}-${i}`} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs">
                                <span className="font-medium text-gray-800">{t.title}</span>
                                <span className="tabular-nums text-gray-400">{t.count.toLocaleString()}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {lcaStats.top_states.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Top worksite states</p>
                          <div className="flex flex-wrap gap-1.5">
                            {lcaStats.top_states.slice(0, 8).map((s) => (
                              <span key={s.state} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs">
                                <span className="font-medium text-gray-800">{s.state}</span>
                                <span className="tabular-nums text-gray-400">{s.count.toLocaleString()}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <p className="mt-5 text-[11px] text-gray-400">
                        Statistical signals only — not legal advice.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">
                      No DOL LCA filings found for {company.name}.
                    </p>
                  )}
                </div>

                {/* 4. JD signal patterns */}
                {jdInsights && jobs.length > 0 && (
                  <div className="border-t border-gray-100 px-6 py-6">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                      Job description signals
                    </p>
                    <p className="mb-5 text-sm text-gray-500">
                      Sponsorship language across {jobs.length} active posting{jobs.length !== 1 ? "s" : ""}.
                    </p>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                      {[
                        { label: "Sponsor-positive",   count: jdInsights.sponsors, dot: "bg-emerald-500", text: "text-emerald-700" },
                        { label: "No sponsorship",     count: jdInsights.denies,   dot: "bg-red-400",     text: "text-red-600"    },
                        { label: "Neutral",            count: jdInsights.neutral,  dot: "bg-gray-300",    text: "text-gray-500"   },
                      ].map(({ label, count, dot, text }) => (
                        <div key={label} className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 flex-shrink-0 rounded-full", dot)} />
                          <span className={cn("text-xl font-bold tabular-nums", text)}>{count}</span>
                          <span className="text-xs text-gray-400">{label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="bg-emerald-500 transition-all" style={{ width: `${(jdInsights.sponsors / jobs.length) * 100}%` }} />
                      <div className="bg-red-400 transition-all" style={{ width: `${(jdInsights.denies / jobs.length) * 100}%` }} />
                    </div>
                    {jdInsights.quotes.length > 0 && (
                      <div className="mt-5 space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Detected language</p>
                        {jdInsights.quotes.map((q, i) => (
                          <p key={i} className="rounded-xl border-l-2 border-[#FF5C18]/30 bg-orange-50/50 px-4 py-3 text-sm italic text-gray-600">
                            &ldquo;{q}&rdquo;
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 5. Similar companies — inside card, no separate card per company */}
                <div className="border-t border-gray-100 px-6 py-6">
                  <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">
                    Similar companies that actively sponsor
                  </p>
                  <SimilarCompanies companyId={id} industry={company.industry} limit={4} />
                </div>
              </div>
            </div>
          )}

          {/* ── About ── */}
          {tab === "about" && (
            <div className="space-y-8">

              {/* Company meta row */}
              {[
                { label: "Industry",      value: company.industry },
                { label: "Size",          value: company.size },
                { label: "Career system", value: company.ats_type
                    ? `${company.ats_type.charAt(0).toUpperCase() + company.ats_type.slice(1)} ATS`
                    : null },
              ].filter((r) => r.value).length > 0 && (
                <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100">
                  {[
                    { label: "Industry",      value: company.industry },
                    { label: "Size",          value: company.size },
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

              {/* Links */}
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

              {/* Employer Health Score */}
              <div className="border-t border-gray-100 pt-8">
                <EmployerHealthScore companyId={id} companyName={company.name} />
              </div>

              {/* Sponsorship Truth Score */}
              <div className="border-t border-gray-100 pt-8">
                <SponsorshipTruthScore companyId={id} companyName={company.name} />
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
