"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ArrowUpRight,
  BarChart3,
  BadgeCheck,
  Bookmark,
  Briefcase,
  Building2,
  Calendar,
  Check,
  Clock3,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Users,
  Zap,
} from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useH1BPrediction } from "@/lib/context/H1BPredictionContext"
import { resolveJobCardView } from "@/lib/jobs/normalization"
import {
  effectiveEmployerSponsorshipScore,
  employerLikelySponsorsH1b,
} from "@/lib/jobs/sponsorship-employer-signal"
import {
  JOB_APPLICATION_SAVED_EVENT,
  fetchJobSavedState,
  saveJobToPipeline,
} from "@/lib/applications/save-job-client"
import { getJobIntelligence } from "@/lib/jobs/intelligence"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"
import {
  getAllResumeSkillLabels,
  normalizeSkillList,
  skillMatches,
} from "@/lib/skills/taxonomy"
import type { JobMatchScore, JobWithCompany, JobWithMatchScore } from "@/types"

type RawRecord = Record<string, unknown>

function normalizeScore(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(numeric)) return null
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

function readRawRecord(job: JobWithCompany | JobWithMatchScore): RawRecord {
  if (job.raw_data && typeof job.raw_data === "object") {
    return job.raw_data as RawRecord
  }
  return {}
}

function pickRawString(raw: RawRecord, keys: string[]) {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function pickRawNumber(raw: RawRecord, keys: string[]) {
  for (const key of keys) {
    const value = raw[key]
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
    if (Number.isFinite(numeric)) return Math.round(numeric)
  }
  return null
}

function pickRawBoolean(raw: RawRecord, keys: string[]) {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase()
      if (normalized === "true") return true
      if (normalized === "false") return false
    }
  }
  return null
}

function formatWorkMode(job: JobWithCompany | JobWithMatchScore) {
  if (job.is_remote) return "Remote"
  if (job.is_hybrid) return "Hybrid"
  return "On-site"
}

function formatCompanySizeLabel(value: JobWithCompany["company"]["size"] | null | undefined) {
  if (!value) return null
  if (value === "startup") return "Startup"
  if (value === "small") return "Small team"
  if (value === "medium") return "Mid-size"
  if (value === "large") return "Large"
  if (value === "enterprise") return "Enterprise"
  return null
}

function formatPostedLabel(timestamp: string, now: number) {
  const normalizedText = timestamp.replace(/^posted\s+/i, "").trim()
  const postedTs = Date.parse(timestamp)
  if (!Number.isFinite(postedTs)) return normalizedText || timestamp
  const ageMinutes = Math.max(1, Math.floor((now - postedTs) / 60_000))
  if (ageMinutes < 60) return `${ageMinutes} min ago`
  const ageHours = Math.floor(ageMinutes / 60)
  if (ageHours < 24) return `${ageHours} hour${ageHours === 1 ? "" : "s"} ago`
  const ageDays = Math.floor(ageHours / 24)
  return `${ageDays} day${ageDays === 1 ? "" : "s"} ago`
}

function getMatchLabel(score: number | null) {
  if (score === null) return "Match unavailable"
  if (score >= 85) return "Excellent"
  if (score >= 70) return "Strong"
  if (score >= 55) return "Moderate"
  return "Low"
}

function getVisaSupportLabel(job: JobWithCompany | JobWithMatchScore, visaLabel: string | null) {
  if (job.requires_authorization) return "Authorization restriction detected"
  if (visaLabel === "Very Strong" || visaLabel === "Strong") return "Likely visa support"
  if (visaLabel === "Medium") return "Possible visa support"
  if (visaLabel === "Weak" || visaLabel === "Blocked") return "Visa support risk"

  const sponsorshipScore = effectiveEmployerSponsorshipScore(job)
  if (employerLikelySponsorsH1b(job) || sponsorshipScore >= 70) return "Likely visa support"
  if (sponsorshipScore >= 55) return "Possible visa support"
  return "Visa support unclear"
}

function buildSkillDiff(
  explicitMatched: string[],
  explicitMissing: string[],
  jobSkills: string[],
  resumeSkills: string[]
) {
  if (explicitMatched.length > 0 || explicitMissing.length > 0) {
    return {
      matched: explicitMatched.slice(0, 6),
      missing: explicitMissing.slice(0, 6),
    }
  }

  if (!jobSkills.length || !resumeSkills.length) {
    return { matched: [] as string[], missing: [] as string[] }
  }

  const matched: string[] = []
  const missing: string[] = []

  for (const skill of jobSkills) {
    const found = resumeSkills.some((candidate) => skillMatches(skill, candidate))
    if (found) matched.push(skill)
    else missing.push(skill)
  }

  return {
    matched: matched.slice(0, 6),
    missing: missing.slice(0, 6),
  }
}

function MatchRing({ score, loading }: { score: number | null; loading: boolean }) {
  const radius = 45
  const size = 120
  const circumference = 2 * Math.PI * radius
  const percent = score === null ? 0 : Math.max(0, Math.min(100, score))
  const dash = (percent / 100) * circumference
  const color = "#f04b0b"

  if (loading) {
    return (
      <div className="flex h-[120px] w-[120px] items-center justify-center rounded-full border-[9px] border-slate-200 bg-white">
        <span className="text-xs font-medium text-slate-400">Scoring</span>
      </div>
    )
  }

  return (
    <div className="relative h-[120px] w-[120px] shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#fbe8df" strokeWidth="9" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[40px] font-extrabold leading-none tracking-[-0.04em] text-slate-950">
          {score ?? "--"}
          <span className="ml-0.5 text-[14px] font-bold tracking-normal text-slate-950">%</span>
        </span>
        <span className="mt-0.5 text-[12px] font-semibold text-[#f04b0b]">Match</span>
      </div>
      <span className="absolute bottom-[13px] right-[8px] h-[14px] w-[14px] rounded-full border-[4px] border-emerald-50 bg-emerald-600" />
    </div>
  )
}

const QuickAnalysisDrawer = dynamic(() => import("@/components/resume/QuickAnalysisDrawer"), { ssr: false })
const H1BPredictionDrawer = dynamic(() => import("@/components/h1b/H1BPredictionDrawer"), { ssr: false })

type JobCardV2Props = {
  job: JobWithCompany | JobWithMatchScore
  hasPrimaryResume?: boolean
  analysisIndex?: number
  isBestMatch?: boolean
  matchScore?: JobMatchScore | null
  isMatchScoreLoading?: boolean
  now?: number
  priorityLogo?: boolean
  /** Show visa-specific badges. Hide for non-international users. */
  showVisaSignals?: boolean
}

export default function JobCardV2({
  job,
  hasPrimaryResume,
  analysisIndex = -1,
  isBestMatch = false,
  matchScore: matchScoreProp,
  isMatchScoreLoading = false,
  now: nowProp,
  priorityLogo = false,
  showVisaSignals = false,
}: JobCardV2Props) {
  const { pushToast } = useToast()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [h1bDrawerOpen, setH1bDrawerOpen] = useState(false)

  const { attachRef: h1bAttachRef, prediction: h1bPrediction, isLoading: h1bIsLoading } = useH1BPrediction(job.id)
  const now = nowProp ?? Date.now()
  const router = useRouter()
  const detailHref = `/dashboard/jobs/${job.id}`
  const { primaryResume } = useResumeContext()
  const showResumeSignal = typeof hasPrimaryResume === "boolean" ? hasPrimaryResume : Boolean(primaryResume)
  void isBestMatch

  const raw = useMemo(() => readRawRecord(job), [job])
  const resolvedMatchScore = matchScoreProp ?? ("match_score" in job ? (job.match_score ?? null) : null)
  const rawScore = pickRawNumber(raw, ["matchScore", "match_score"])
  const score = normalizeScore(resolvedMatchScore?.overall_score ?? rawScore)
  const matchLabel = pickRawString(raw, ["matchLabel", "match_label"]) ?? getMatchLabel(score)

  const cardView = resolveJobCardView(job)
  const displayTitle = cardView.title
  const companyName = job.company?.name ?? "Unknown company"
  const companyDomain = job.company?.domain ?? null
  const companyLogoUrl = job.company?.logo_url ?? pickRawString(raw, ["companyLogo", "company_logo"]) ?? null
  const companyProfileHref = job.company?.id ? `/companies/${job.company.id}` : null

  const workMode = pickRawString(raw, ["workMode", "work_mode"]) ?? formatWorkMode(job)
  const employmentType = cardView.employment_label ?? pickRawString(raw, ["employmentType", "employment_type"]) ?? "Not specified"
  const salaryRange = cardView.salary_label ?? pickRawString(raw, ["salaryRange", "salary_range", "salary"]) ?? "Not disclosed"
  const postedSource =
    pickRawString(raw, ["postedAtNormalized", "posted_at_normalized", "postedAt", "posted_at"]) ??
    job.first_detected_at
  const postedAt = formatPostedLabel(postedSource, now)

  const companySummary = pickRawString(raw, [
    "companySummary",
    "company_summary",
    "companyDescription",
    "company_description",
    "companyOverview",
    "company_overview",
  ])
  const companyFoundedYear = pickRawNumber(raw, ["companyFoundedYear", "company_founded_year", "foundedYear", "founded_year", "founded"])
  const companyEmployeeCountRaw =
    pickRawString(raw, ["companyEmployeeCount", "company_employee_count", "employee_count", "headcount"]) ??
    (pickRawNumber(raw, ["companyEmployeeCount", "company_employee_count", "employee_count", "headcount"])?.toLocaleString() ?? null)
  const companyEmployeeCount =
    companyEmployeeCountRaw ??
    formatCompanySizeLabel(job.company?.size)
  const companyIndustry = job.company?.industry ?? pickRawString(raw, ["companyIndustry", "company_industry", "industry"])
  const companyVerified = pickRawBoolean(raw, ["companyVerified", "company_verified", "verifiedCompany", "verified_company"]) === true

  const easyApply = pickRawBoolean(raw, ["easyApply", "easy_apply", "quickApply", "quick_apply"]) ?? false
  const activelyHiring = pickRawBoolean(raw, ["activelyHiring", "actively_hiring", "urgent_hiring"]) ?? false

  const intel = useMemo(() => getJobIntelligence(job), [job])
  const visaSupportLabel = getVisaSupportLabel(job, intel.visa?.label ?? null)

  const topApplicantSignal = pickRawBoolean(raw, ["topApplicantSignal", "top_applicant_signal"]) === true

  const explicitMatchedSkills = useMemo(
    () => normalizeSkillList(
      [
        ...(resolvedMatchScore?.score_breakdown?.matchedSkills ?? []),
        ...(intel.matchScore?.matchedSkills ?? []),
      ],
      8
    ),
    [resolvedMatchScore?.score_breakdown?.matchedSkills, intel.matchScore?.matchedSkills]
  )

  const explicitMissingSkills = useMemo(
    () => normalizeSkillList(
      [
        ...(resolvedMatchScore?.score_breakdown?.missingSkills ?? []),
        ...(intel.matchScore?.missingSkills ?? []),
      ],
      8
    ),
    [resolvedMatchScore?.score_breakdown?.missingSkills, intel.matchScore?.missingSkills]
  )

  const resumeSkills = useMemo(
    () => getAllResumeSkillLabels(primaryResume),
    [primaryResume]
  )

  const jobSkills = useMemo(
    () => normalizeSkillList([...(job.skills ?? []), ...cardView.skills], 10),
    [job.skills, cardView.skills]
  )

  const skillDiff = useMemo(
    () =>
      buildSkillDiff(
        explicitMatchedSkills,
        explicitMissingSkills,
        jobSkills,
        showResumeSignal ? resumeSkills : []
      ),
    [explicitMatchedSkills, explicitMissingSkills, jobSkills, resumeSkills, showResumeSignal]
  )

  const matchedSkills = skillDiff.matched
  const missingSkills = skillDiff.missing
  const matchedSkillsVisible = matchedSkills.slice(0, 4)
  const missingSkillsVisible = missingSkills.slice(0, 3)
  const matchedSkillsExtra = Math.max(0, matchedSkills.length - matchedSkillsVisible.length)
  const missingSkillsExtra = Math.max(0, missingSkills.length - missingSkillsVisible.length)
  const sponsorshipSignalRaw = pickRawString(raw, [
    "sponsorshipSignal",
    "sponsorship_signal",
    "visaSupport",
    "visa_support",
  ])
  const sponsorshipSignal =
    sponsorshipSignalRaw ??
    (job.requires_authorization
      ? "Authorization required"
      : employerLikelySponsorsH1b(job) || effectiveEmployerSponsorshipScore(job) >= 55
        ? "Visa support likely"
        : "Visa support unclear")
  const visaSupportTitle =
    visaSupportLabel === "Likely visa support"
      ? "Strong Visa Support"
      : visaSupportLabel === "Possible visa support"
        ? "Visa Support"
        : "Visa Review Needed"
  const showCompanySnapshot = Boolean(companySummary || companyFoundedYear || companyEmployeeCount || companyIndustry)

  const whyMatchBullets = useMemo(() => {
    const bullets: string[] = []

    if (score !== null) {
      if (score >= 85) bullets.push("High match score based on your current resume and profile.")
      else if (score >= 70) bullets.push("Strong overall alignment for this role.")
      else if (score >= 55) bullets.push("Moderate match with room to improve before applying.")
    }

    if (matchedSkills.length > 0) {
      bullets.push(`Skills overlap: ${matchedSkills.slice(0, 3).join(", ")}.`)
    }

    if (visaSupportLabel === "Likely visa support" || visaSupportLabel === "Possible visa support") {
      bullets.push("Visa support signals are favorable compared with similar listings.")
    }

    if (topApplicantSignal || activelyHiring) {
      bullets.push("Competition signal suggests this can be a timely application.")
    }

    if (bullets.length === 0) {
      bullets.push("Core role signals align with your current search preferences.")
    }

    return bullets.slice(0, 2)
  }, [score, matchedSkills, visaSupportLabel, topApplicantSignal, activelyHiring])

  useEffect(() => {
    let cancelled = false
    void fetchJobSavedState(job.id).then((isSaved) => {
      if (!cancelled) setSaved(isSaved)
    })
    return () => {
      cancelled = true
    }
  }, [job.id])

  useEffect(() => {
    function onSync(e: Event) {
      const detail = (e as CustomEvent<{ jobId?: string }>).detail
      if (detail?.jobId === job.id) setSaved(true)
    }
    window.addEventListener(JOB_APPLICATION_SAVED_EVENT, onSync as EventListener)
    return () => window.removeEventListener(JOB_APPLICATION_SAVED_EVENT, onSync as EventListener)
  }, [job.id])

  useEffect(() => {
    if (analysisIndex < 10) router.prefetch(detailHref)
  }, [analysisIndex, detailHref, router])

  async function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (saving || saved) return
    setSaving(true)
    try {
      const result = await saveJobToPipeline({
        jobId: job.id,
        companyName,
        companyLogoUrl,
        jobTitle: displayTitle,
        applyUrl: job.apply_url,
        matchScore: score,
        source: "hireoven_feed",
      })
      if (!result.ok) {
        if (result.status === 401) {
          pushToast({ tone: "info", title: "Sign in to save jobs", description: result.message })
          return
        }
        pushToast({ tone: "error", title: "Save failed", description: result.message })
        return
      }
      setSaved(true)
      window.dispatchEvent(new CustomEvent(JOB_APPLICATION_SAVED_EVENT, { detail: { jobId: job.id } }))
      if (!result.alreadySaved) {
        pushToast({ tone: "success", title: "Saved to pipeline", description: "View it under Applications → Saved." })
      }
    } catch (err) {
      pushToast({ tone: "error", title: "Save failed", description: err instanceof Error ? err.message : "Try again." })
    } finally {
      setSaving(false)
    }
  }

  function openMatchDetail(e: React.MouseEvent) {
    e.stopPropagation()
    if (score === null) return
    if (resolvedMatchScore?.score_method === "deep") {
      router.push(`/dashboard/resume/analyze/${job.id}`)
    } else {
      setDrawerOpen(true)
    }
  }

  return (
    <>
      <article
        ref={h1bAttachRef as (node: HTMLElement | null) => void}
        role="button"
        tabIndex={0}
        onMouseEnter={() => router.prefetch(detailHref)}
        onFocus={() => router.prefetch(detailHref)}
        onClick={() => router.push(detailHref)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            router.push(detailHref)
          }
        }}
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.05)] transition-all duration-150 hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600/20"
      >
        <div className="px-5 pb-5 pt-5 sm:px-6">
          <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
            <div className="min-w-0 lg:flex-[1.08] lg:border-r lg:border-slate-200 lg:pr-6">
              <div className="flex min-w-0 gap-4">
                <CompanyLogo
                  companyName={companyName}
                  domain={companyDomain}
                  logoUrl={companyLogoUrl}
                  priority={priorityLogo}
                  className="h-[104px] w-[104px] flex-shrink-0 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 sm:h-[112px] sm:w-[112px]"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <h3 className="line-clamp-2 text-[16px] font-bold leading-tight text-slate-950">{displayTitle}</h3>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {companyProfileHref ? (
                      <Link
                        href={companyProfileHref}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[14px] font-semibold text-slate-900 transition hover:text-orange-600 hover:underline"
                      >
                        {companyName}
                      </Link>
                    ) : (
                      <span className="text-[14px] font-semibold text-slate-900">{companyName}</span>
                    )}
                    {companyVerified && (
                      <BadgeCheck className="h-4 w-4 shrink-0 text-orange-600" aria-label="Verified company" />
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600">
                    {job.location?.trim() && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-4 w-4 text-slate-500" aria-hidden />
                        {job.location}
                      </span>
                    )}
                    <span className="text-slate-300" aria-hidden>•</span>
                    <span>{workMode}</span>
                    <span className="text-slate-300" aria-hidden>•</span>
                    <span className="inline-flex items-center gap-1">
                      <Briefcase className="h-4 w-4 text-slate-500" aria-hidden />
                      {employmentType}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {activelyHiring && (
                      <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-700">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        Actively hiring
                      </span>
                    )}
                    {easyApply && (
                      <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-blue-50 px-3 py-1.5 text-[12px] font-medium text-blue-700">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-blue-600 text-[9px] font-bold text-white">
                          in
                        </span>
                        Easy Apply
                      </span>
                    )}
                    {topApplicantSignal && (
                      <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-orange-50 px-3 py-1.5 text-[12px] font-medium text-orange-700">
                        <Trophy className="h-3.5 w-3.5" aria-hidden />
                        Top Applicant
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-w-0 lg:flex-[0.95] lg:pr-1">
              {matchedSkills.length > 0 && (
                <>
                  <p className="text-[12px] font-semibold text-emerald-700">Top matched skills</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {matchedSkillsVisible.map((skill) => (
                      <span
                        key={`match-${job.id}-${skill}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        {skill}
                      </span>
                    ))}
                    {matchedSkillsExtra > 0 && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500">
                        +{matchedSkillsExtra} more
                      </span>
                    )}
                  </div>
                </>
              )}

              {missingSkills.length > 0 && (
                <>
                  <p className={cn("text-[12px] font-semibold text-orange-600", matchedSkills.length > 0 ? "mt-4" : "mt-0")}>
                    Skills to improve
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {missingSkillsVisible.map((skill) => (
                      <span
                        key={`missing-${job.id}-${skill}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-white px-3 py-1.5 text-[11px] font-medium text-orange-600"
                      >
                        <span className="text-[14px] leading-none">+</span>
                        {skill}
                      </span>
                    ))}
                    {missingSkillsExtra > 0 && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500">
                        +{missingSkillsExtra} more
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 lg:w-[180px] lg:flex-col lg:items-end lg:justify-start">
              <button
                type="button"
                onClick={openMatchDetail}
                disabled={score === null && !isMatchScoreLoading}
                aria-label={matchLabel}
                className="rounded-2xl p-1 transition hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600/30 disabled:cursor-default"
              >
                <MatchRing score={score} loading={isMatchScoreLoading && score === null} />
              </button>

              <div
                className="flex items-center gap-1.5 transition-opacity duration-150 group-hover:pointer-events-none group-hover:opacity-0 group-focus-within:pointer-events-none group-focus-within:opacity-0"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  aria-label={saved ? "Saved" : "Save"}
                  className={cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-orange-200 hover:text-orange-600",
                    saved && "text-orange-600"
                  )}
                >
                  <Bookmark className={cn("h-4 w-4", saved && "fill-current")} />
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/scout?jobId=${job.id}`)}
                  aria-label="Compare"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-orange-200 hover:text-orange-600"
                >
                  <BarChart3 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => router.push(detailHref)}
                  aria-label="View details"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-orange-600 transition hover:border-orange-200 hover:bg-orange-50"
                >
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden">
          <div className="max-h-0 -translate-y-1 opacity-0 transition-all duration-150 ease-out group-hover:max-h-[420px] group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:max-h-[420px] group-focus-within:translate-y-0 group-focus-within:opacity-100">
            <div className="px-5 pb-2 sm:px-6">
              <div className="rounded-2xl border border-slate-200 bg-white">
                <div
                  className={cn(
                    "grid",
                    showCompanySnapshot
                      ? "lg:grid-cols-[232px_1fr_1fr_214px]"
                      : "lg:grid-cols-[232px_1fr_214px]"
                  )}
                >
                  <div className="space-y-3 border-b border-slate-200 p-3 lg:border-b-0 lg:border-r">
                    <div className="flex items-start gap-3">
                      <Calendar className="mt-0.5 h-4 w-4 text-slate-600" />
                      <div>
                        <p className="text-[13px] font-semibold text-slate-900">{salaryRange}</p>
                        <p className="text-[11px] text-slate-500">Est. Salary</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (showVisaSignals) setH1bDrawerOpen(true)
                      }}
                      className="flex items-start gap-3 text-left"
                    >
                      <ShieldCheck className={cn("mt-0.5 h-4 w-4", visaSupportTitle.includes("Strong") ? "text-emerald-700" : "text-orange-600")} />
                      <div>
                        <p className={cn("text-[13px] font-semibold", visaSupportTitle.includes("Strong") ? "text-emerald-700" : "text-orange-600")}>
                          {visaSupportTitle}
                        </p>
                        <p className="text-[11px] text-slate-500">{sponsorshipSignal}</p>
                      </div>
                    </button>
                    <div className="flex items-start gap-3">
                      <Clock3 className="mt-0.5 h-4 w-4 text-slate-600" />
                      <div>
                        <p className="text-[13px] font-medium text-slate-700">Posted {postedAt}</p>
                        <p className="text-[11px] font-medium text-orange-600">Quick Apply</p>
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-slate-200 p-3 lg:border-b-0 lg:border-r">
                    <p className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
                      <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                      Why this job is a great match
                    </p>
                    <div className="mt-2 space-y-1">
                      {whyMatchBullets.map((bullet, index) => (
                        <p key={`${job.id}-match-bullet-${index}`} className="flex items-start gap-2 text-[12px] text-slate-700">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span>{bullet}</span>
                        </p>
                      ))}
                    </div>
                  </div>

                  {showCompanySnapshot && (
                    <div className="border-b border-slate-200 p-3 lg:border-b-0 lg:border-r">
                      <p className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
                        <Building2 className="h-3.5 w-3.5 text-slate-600" />
                        About {companyName}
                      </p>
                      {companySummary && (
                        <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-slate-700">{companySummary}</p>
                      )}

                      {(companyFoundedYear || companyEmployeeCount || companyIndustry) && (
                        <div className="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-1">
                          {companyFoundedYear && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-700">
                              <Calendar className="h-3 w-3 text-slate-500" />
                              {companyFoundedYear} Founded
                            </span>
                          )}
                          {companyEmployeeCount && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-700">
                              <Users className="h-3 w-3 text-slate-500" />
                              {companyEmployeeCount} Employees
                            </span>
                          )}
                          {companyIndustry && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-700">
                              <Building2 className="h-3 w-3 text-slate-500" />
                              {companyIndustry}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="p-3">
                    <div className="h-full rounded-2xl border border-slate-200 bg-white p-3">
                      <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
                        <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                        Improve your odds
                      </p>
                      <p className="mt-1.5 text-[12px] leading-5 text-slate-700">
                        Tailor your resume for this role in 30 seconds.
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/dashboard/resume/analyze/${job.id}`)
                        }}
                        className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#f04b0b] px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-orange-700"
                      >
                        Tailor Resume
                        <Sparkles className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-slate-100 px-5 pb-3 pt-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className={cn(
                    "inline-flex min-w-[108px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-medium transition",
                    saved
                      ? "border-orange-200 bg-orange-50 text-orange-700"
                      : "border-slate-200 bg-white text-slate-800 hover:border-orange-200 hover:bg-orange-50"
                  )}
                >
                  <Star className={cn("h-5 w-5", saved && "fill-current")} />
                  {saved ? "Saved" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/scout?jobId=${job.id}`)}
                  className="inline-flex min-w-[122px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-800 transition hover:border-orange-200 hover:bg-orange-50"
                >
                  <BarChart3 className="h-4 w-4" />
                  Compare
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-orange-50/50 p-1.5 sm:justify-end">
                <a
                  href={job.apply_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex min-w-[156px] items-center justify-center gap-1.5 rounded-xl border border-orange-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-orange-600 transition hover:bg-orange-50"
                >
                  <Zap className="h-4 w-4" />
                  Quick Apply
                </a>
                <button
                  type="button"
                  onClick={() => router.push(detailHref)}
                  className="inline-flex min-w-[176px] items-center justify-center gap-1.5 rounded-xl bg-[#f04b0b] px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-orange-700"
                >
                  View Details
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </article>

      {drawerOpen && primaryResume?.id && (
        <QuickAnalysisDrawer
          resumeId={primaryResume.id}
          jobId={job.id}
          jobTitle={`${job.title} at ${companyName}`}
          applyUrl={job.apply_url}
          onClose={() => setDrawerOpen(false)}
          autoAnalyze={analysisIndex < 10}
        />
      )}

      {h1bDrawerOpen && (
        <H1BPredictionDrawer
          jobId={job.id}
          jobTitle={displayTitle}
          companyName={companyName}
          prediction={h1bPrediction ?? job.h1b_prediction ?? null}
          isLoading={h1bIsLoading && !h1bPrediction && !job.h1b_prediction}
          onClose={() => setH1bDrawerOpen(false)}
        />
      )}
    </>
  )
}
