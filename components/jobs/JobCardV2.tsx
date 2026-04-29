"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Bookmark,
  Briefcase,
  Building2,
  Check,
  MapPin,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Trophy,
  Wifi,
  Zap,
} from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useH1BPrediction } from "@/lib/context/H1BPredictionContext"
import {
  formatEmploymentLabel,
  formatSalaryLabel,
  resolveJobCardView,
} from "@/lib/jobs/normalization"
import { employerLikelySponsorsH1b } from "@/lib/jobs/sponsorship-employer-signal"
import { buildTopApplicantOpportunityBadgeTitle } from "@/lib/jobs/job-card-badges"
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
  if (job.raw_data && typeof job.raw_data === "object") return job.raw_data as RawRecord
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
      const n = value.trim().toLowerCase()
      if (n === "true") return true
      if (n === "false") return false
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
  if (ageMinutes < 60) return `${ageMinutes}m ago`
  const ageHours = Math.floor(ageMinutes / 60)
  if (ageHours < 24) return `${ageHours}h ago`
  const ageDays = Math.floor(ageHours / 24)
  return `${ageDays}d ago`
}

function getMatchLabel(score: number | null) {
  if (score === null) return "Match unavailable"
  if (score >= 85) return "Excellent"
  if (score >= 70) return "Strong"
  if (score >= 55) return "Moderate"
  return "Low"
}

function resolveVisaCardLabel(
  job: JobWithCompany | JobWithMatchScore,
  normLabel: "Sponsors" | "No sponsorship" | "Historical sponsorship signal" | null
): "Sponsors" | "No sponsorship" | "Historical sponsorship signal" | null {
  if (normLabel !== null) return normLabel
  const hasCompanyH1bData =
    employerLikelySponsorsH1b(job) ||
    (("company" in job && job.company != null)
      ? ((job.company as Record<string, unknown>).h1b_sponsor_count_1yr as number | null ?? 0) > 0
      : false)
  if (hasCompanyH1bData) return "Historical sponsorship signal"
  if (job.requires_authorization) return "No sponsorship"
  return null
}

function buildSkillDiff(
  explicitMatched: string[],
  explicitMissing: string[],
  jobSkills: string[],
  resumeSkills: string[]
) {
  if (explicitMatched.length > 0 || explicitMissing.length > 0) {
    return { matched: explicitMatched.slice(0, 6), missing: explicitMissing.slice(0, 6) }
  }
  if (!jobSkills.length || !resumeSkills.length) {
    return { matched: [] as string[], missing: [] as string[] }
  }
  const matched: string[] = []
  const missing: string[] = []
  for (const skill of jobSkills) {
    const found = resumeSkills.some((c) => skillMatches(skill, c))
    if (found) matched.push(skill)
    else missing.push(skill)
  }
  return { matched: matched.slice(0, 6), missing: missing.slice(0, 6) }
}

// ---------------------------------------------------------------------------
// Score-derived styles
// ---------------------------------------------------------------------------

function scoreGradient(score: number | null): string {
  if (score == null) return "from-slate-400 to-slate-500"
  if (score >= 85) return "from-emerald-500 to-teal-600"
  if (score >= 70) return "from-blue-500 to-indigo-600"
  if (score >= 55) return "from-amber-500 to-orange-500"
  return "from-slate-500 to-slate-600"
}

function scoreAccent(score: number | null): string {
  if (score == null) return "from-slate-300 via-slate-400 to-slate-300"
  if (score >= 85) return "from-emerald-400 via-teal-400 to-cyan-400"
  if (score >= 70) return "from-blue-400 via-indigo-400 to-violet-400"
  if (score >= 55) return "from-amber-400 via-orange-400 to-rose-400"
  return "from-slate-400 via-slate-500 to-slate-400"
}

// Full class strings so Tailwind doesn't purge them
function scoreHoverRing(score: number | null): string {
  if (score == null) return "hover:ring-2 hover:ring-slate-300/60"
  if (score >= 85) return "hover:ring-2 hover:ring-emerald-400/50"
  if (score >= 70) return "hover:ring-2 hover:ring-blue-400/50"
  if (score >= 55) return "hover:ring-2 hover:ring-amber-400/50"
  return "hover:ring-2 hover:ring-slate-300/60"
}

/**
 * Read the first usable company_info item from wherever the normalizer stored it.
 * Tries three storage paths in priority order:
 *   1. raw_data.normalized.sections.company_info.items  (CanonicalJob shape)
 *   2. raw_data.structured_job.sections.companyInfo     (toStructuredJobData shape)
 *   3. raw_data.view.page.sections.company_info.items   (JobPageViewModel shape)
 */
function readNormalizedCompanyInfo(raw: RawRecord): string | null {
  const tryStringArray = (value: unknown): string | null => {
    if (!Array.isArray(value)) return null
    const first = value.find((v): v is string => typeof v === "string" && v.trim().length > 20)
    return first?.trim() ?? null
  }

  try {
    // Path 1: raw_data.normalized.sections.company_info.items
    const normalized = raw.normalized as RawRecord | null
    if (normalized) {
      const sections = normalized.sections as RawRecord | null
      const ci = sections?.company_info as { items?: unknown[] } | null
      const result = tryStringArray(ci?.items)
      if (result) return result
    }
  } catch {}

  try {
    // Path 2: raw_data.structured_job.sections.companyInfo
    const structured = raw.structured_job as RawRecord | null
    if (structured) {
      const sections = structured.sections as RawRecord | null
      const result = tryStringArray(sections?.companyInfo)
      if (result) return result
    }
  } catch {}

  try {
    // Path 3: raw_data.view.page.sections.company_info.items
    const view = raw.view as RawRecord | null
    const page = view?.page as RawRecord | null
    if (page) {
      const sections = page.sections as RawRecord | null
      const ci = sections?.company_info as { items?: unknown[] } | null
      const result = tryStringArray(ci?.items)
      if (result) return result
    }
  } catch {}

  return null
}

function seniorityPillStyle(label: string | null): string {
  if (!label) return ""
  const l = label.toLowerCase()
  if (l === "intern" || l === "junior") return "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
  if (l === "mid") return "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
  if (l === "senior") return "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
  return "bg-purple-50 text-purple-700 ring-1 ring-purple-200"
}

// ---------------------------------------------------------------------------
// Match badge (replaces the SVG ring)
// ---------------------------------------------------------------------------

function MatchBadge({ score, loading }: { score: number | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex h-[70px] w-[62px] shrink-0 flex-col items-center justify-center rounded-xl bg-slate-100">
        <span className="text-[10px] font-semibold text-slate-400">Scoring</span>
      </div>
    )
  }
  const gradient = scoreGradient(score)
  return (
    <div className={cn("flex h-[70px] w-[62px] shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-br text-white", gradient)}>
      <span className="text-[24px] font-extrabold leading-none tabular-nums">
        {score ?? "—"}
      </span>
      {score !== null && (
        <span className="text-[10px] font-bold leading-none text-white/75">%</span>
      )}
      <span className="mt-1 text-[9px] font-bold uppercase tracking-widest text-white/70">
        match
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dynamic drawers
// ---------------------------------------------------------------------------

const QuickAnalysisDrawer = dynamic(() => import("@/components/resume/QuickAnalysisDrawer"), { ssr: false })
const H1BPredictionDrawer = dynamic(() => import("@/components/h1b/H1BPredictionDrawer"), { ssr: false })

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type JobCardV2Props = {
  job: JobWithCompany | JobWithMatchScore
  hasPrimaryResume?: boolean
  analysisIndex?: number
  isBestMatch?: boolean
  matchScore?: JobMatchScore | null
  isMatchScoreLoading?: boolean
  now?: number
  priorityLogo?: boolean
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
  const matchLabel = getMatchLabel(score)

  const cardView = resolveJobCardView(job)
  const displayTitle = cardView.title
  const companyName = job.company?.name ?? "Unknown company"
  const companyDomain = job.company?.domain ?? null
  const companyLogoUrl = job.company?.logo_url ?? pickRawString(raw, ["companyLogo", "company_logo"]) ?? null
  const companyProfileHref = job.company?.id ? `/companies/${job.company.id}` : null

  const workMode = formatWorkMode(job)
  const employmentType =
    cardView.employment_label ?? formatEmploymentLabel(job.employment_type) ?? "Full-time"
  const salaryRange =
    cardView.salary_label ??
    formatSalaryLabel(job.salary_min, job.salary_max, job.salary_currency) ??
    null

  const postedSource = pickRawString(raw, ["posted_at_normalized"]) ?? job.first_detected_at
  const postedAt = formatPostedLabel(postedSource, now)

  // Age-based freshness for color coding
  const freshnessDays = (() => {
    const ts = postedSource ? Date.parse(postedSource) : NaN
    return Number.isFinite(ts) ? Math.floor((now - ts) / 86_400_000) : null
  })()

  const postedDotColor =
    freshnessDays === null ? "bg-slate-300"
    : freshnessDays === 0  ? "bg-emerald-500"
    : freshnessDays <= 3   ? "bg-sky-400"
    : freshnessDays <= 14  ? "bg-slate-400"
    : "bg-amber-400"

  const postedTextColor =
    freshnessDays === null ? "text-slate-400"
    : freshnessDays === 0  ? "text-emerald-600"
    : freshnessDays <= 3   ? "text-sky-600"
    : freshnessDays <= 14  ? "text-slate-500"
    : "text-amber-600"

  const seniorityLabel = cardView.seniority_label

  const companySummary =
    pickRawString(raw, ["companySummary", "company_summary"]) ??
    readNormalizedCompanyInfo(raw)
  const companySector = job.company?.industry ?? pickRawString(raw, ["companyIndustry"])
  const companySize = formatCompanySizeLabel(job.company?.size)
  const companyVerified = pickRawBoolean(raw, ["companyVerified", "company_verified"]) === true

  // H1B / company sponsorship data — Company type has these as direct fields
  const h1bCount1yr = job.company?.h1b_sponsor_count_1yr ?? 0
  const h1bCount3yr = job.company?.h1b_sponsor_count_3yr ?? 0
  const sponsorConfidence = job.company?.sponsorship_confidence ?? 0
  const companySponsorsH1b = job.company?.sponsors_h1b === true
  const hasH1bData = companySponsorsH1b || h1bCount1yr > 0 || job.sponsors_h1b === true

  const easyApply = pickRawBoolean(raw, ["easyApply", "easy_apply"]) ?? false

  // Actively recruiting: raw crawler boolean OR detected from title/description text
  const activelyHiring = useMemo(() => {
    if (pickRawBoolean(raw, ["activelyHiring", "actively_hiring"]) === true) return true
    const haystack = [
      job.title ?? "",
      cardView.preview_description ?? "",
      pickRawString(raw, ["sponsorshipSignal", "sponsorship_signal"]) ?? "",
    ].join(" ")
    return /\b(actively\s+(?:recruiting|hiring|seeking)|urgently?\s+hiring|hiring\s+now|now\s+hiring|immediate(?:ly)?\s+(?:hire|hiring|need|opening)|urgent(?:ly)?\s+(?:hiring|need)|high(?:ly)?\s+priority\s+role)\b/i.test(haystack)
  }, [raw, job.title, cardView.preview_description])

  // LinkedIn indicator: detect from the apply URL
  const isLinkedIn = /linkedin\.com/i.test(job.apply_url ?? "")

  // Autofill & Apply: use the internal autofill wizard when the job has a known ATS.
  // 'custom' means we couldn't detect the ATS — fall back to external Quick Apply.
  const atsType = job.company?.ats_type
  const canAutofill = atsType != null && atsType !== "custom"

  const intelMatchScore = useMemo(() => getJobIntelligence(job).matchScore, [job])

  const visaCardLabel = useMemo(
    () => resolveVisaCardLabel(job, cardView.visa_card_label),
    [job, cardView.visa_card_label]
  )
  // JD says "no sponsorship" → suppress all positive company signals for this role.
  // Only trust H1B/LCA data when the posting has no explicit negative language.
  const jdBlocksSponsorship =
    visaCardLabel === "No sponsorship" || job.requires_authorization === true

  // Sponsorship row shown in the card body — factual, never invented.
  // Positive company signals are gated by jdBlocksSponsorship.
  const sponsorshipDisplay = (() => {
    if (jdBlocksSponsorship) {
      return { label: "No sponsorship", sub: "from posting", tone: "rose" } as const
    }
    if (visaCardLabel === "Sponsors" || job.sponsors_h1b === true) {
      return { label: "Sponsorship available", sub: "from job description", tone: "emerald" } as const
    }
    if (companySponsorsH1b && h1bCount1yr > 0) {
      return { label: "H-1B sponsor", sub: `${h1bCount1yr} petition${h1bCount1yr === 1 ? "" : "s"} last yr`, tone: "emerald" } as const
    }
    if (h1bCount1yr > 0) {
      return { label: `${h1bCount1yr} H-1B petition${h1bCount1yr === 1 ? "" : "s"} last yr`, sub: "historical signal", tone: "sky" } as const
    }
    return null
  })()


  const rawTopApplicantFlag = pickRawBoolean(raw, ["topApplicantSignal", "top_applicant_signal"]) === true
  const topApplicantSignal = useMemo(() => {
    if (!rawTopApplicantFlag) return false
    const { show } = buildTopApplicantOpportunityBadgeTitle(job, score)
    return show
  }, [rawTopApplicantFlag, job, score])

  const explicitMatchedSkills = useMemo(
    () => normalizeSkillList([
      ...(resolvedMatchScore?.score_breakdown?.matchedSkills ?? []),
      ...(intelMatchScore?.matchedSkills ?? []),
    ], 8),
    [resolvedMatchScore?.score_breakdown?.matchedSkills, intelMatchScore?.matchedSkills]
  )
  const explicitMissingSkills = useMemo(
    () => normalizeSkillList([
      ...(resolvedMatchScore?.score_breakdown?.missingSkills ?? []),
      ...(intelMatchScore?.missingSkills ?? []),
    ], 8),
    [resolvedMatchScore?.score_breakdown?.missingSkills, intelMatchScore?.missingSkills]
  )

  const resumeSkills = useMemo(() => getAllResumeSkillLabels(primaryResume), [primaryResume])
  const jobSkills = useMemo(
    () => normalizeSkillList([...(job.skills ?? []), ...cardView.skills], 10),
    [job.skills, cardView.skills]
  )

  const skillDiff = useMemo(
    () => buildSkillDiff(explicitMatchedSkills, explicitMissingSkills, jobSkills, showResumeSignal ? resumeSkills : []),
    [explicitMatchedSkills, explicitMissingSkills, jobSkills, resumeSkills, showResumeSignal]
  )

  const matchedSkills = skillDiff.matched
  const missingSkills = skillDiff.missing
  const matchedVisible = matchedSkills.slice(0, 4)
  const missingVisible = missingSkills.slice(0, 3)
  const matchedExtra = Math.max(0, matchedSkills.length - matchedVisible.length)
  const missingExtra = Math.max(0, missingSkills.length - missingVisible.length)

  const whyBullets = useMemo(() => {
    const bullets: string[] = []
    if (score !== null) {
      if (score >= 85) bullets.push("Excellent match based on your resume and profile.")
      else if (score >= 70) bullets.push("Strong overall alignment for this role.")
      else if (score >= 55) bullets.push("Moderate match — worth tailoring your resume.")
    }
    if (matchedSkills.length > 0) {
      bullets.push(`Skills overlap: ${matchedSkills.slice(0, 3).join(", ")}.`)
    }
    if (visaCardLabel === "Sponsors" || visaCardLabel === "Historical sponsorship signal") {
      bullets.push("Favorable sponsorship signals vs similar listings.")
    }
    if (topApplicantSignal || activelyHiring) {
      bullets.push("Fresh posting — good window to apply early.")
    }
    if (bullets.length === 0) bullets.push("Role signals align with your search preferences.")
    return bullets.slice(0, 2)
  }, [score, matchedSkills, visaCardLabel, topApplicantSignal, activelyHiring])

  useEffect(() => {
    let cancelled = false
    void fetchJobSavedState(job.id).then((v) => { if (!cancelled) setSaved(v) })
    return () => { cancelled = true }
  }, [job.id])

  useEffect(() => {
    function onSync(e: Event) {
      if ((e as CustomEvent<{ jobId?: string }>).detail?.jobId === job.id) setSaved(true)
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

  // Work mode pill styling
  const workModePill =
    workMode === "Remote"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : workMode === "Hybrid"
        ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
        : "bg-slate-100 text-slate-600"

  const showCompanySnippet = Boolean(companySummary || companySector || companySize)

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
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(detailHref) }
        }}
        className={cn(
          "group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-transparent hover:shadow-[0_12px_32px_rgba(15,23,42,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30",
          scoreHoverRing(score)
        )}
      >
        {/* ── Gradient accent strip — color maps to match quality ── */}
        <div className={cn("h-[3px] w-full shrink-0 bg-gradient-to-r", scoreAccent(score))} />

        {/* ── Card body ── */}
        <div className="px-5 py-4 sm:px-6">
          <div className="flex min-w-0 gap-4">
            {/* Logo */}
            <CompanyLogo
              companyName={companyName}
              domain={companyDomain}
              logoUrl={companyLogoUrl}
              priority={priorityLogo}
              className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-1"
            />

            {/* Main info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-slate-950">
                    {displayTitle}
                  </h3>

                  {/* Company row */}
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {companyProfileHref ? (
                      <Link
                        href={companyProfileHref}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[13px] font-semibold text-slate-600 transition hover:text-indigo-600 hover:underline"
                      >
                        {companyName}
                      </Link>
                    ) : (
                      <span className="text-[13px] font-semibold text-slate-600">{companyName}</span>
                    )}
                    {companyVerified && (
                      <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-indigo-500" aria-label="Verified" />
                    )}
                    {hasH1bData && (
                      <span title="Company has H-1B petition history" aria-label="H-1B petition history on record">
                        <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden />
                      </span>
                    )}
                    {isLinkedIn && (
                      <span
                        title="Apply via LinkedIn"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-[#0077B5] text-[9px] font-black leading-none text-white"
                      >
                        in
                      </span>
                    )}
                  </div>

                  {/* Location · mode · seniority · type · salary */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {job.location?.trim() && (
                      <span className="inline-flex items-center gap-1 text-[12px] text-slate-500">
                        <MapPin className="h-3 w-3" aria-hidden />
                        {job.location}
                      </span>
                    )}
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", workModePill)}>
                      {workMode === "Remote"
                        ? <Wifi className="h-3 w-3" aria-hidden />
                        : workMode === "Hybrid"
                          ? <Building2 className="h-3 w-3" aria-hidden />
                          : <MapPin className="h-3 w-3" aria-hidden />
                      }
                      {workMode}
                    </span>
                    {seniorityLabel && (
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", seniorityPillStyle(seniorityLabel))}>
                        {seniorityLabel}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[12px] text-slate-500">
                      <Briefcase className="h-3 w-3 text-slate-400" aria-hidden />
                      {employmentType}
                    </span>
                    {salaryRange && (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
                        <Banknote className="h-3 w-3" aria-hidden />
                        {salaryRange}
                      </span>
                    )}
                  </div>
                </div>

                {/* Match badge */}
                <button
                  type="button"
                  onClick={openMatchDetail}
                  disabled={score === null && !isMatchScoreLoading}
                  aria-label={matchLabel}
                  className="shrink-0 rounded-xl transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 disabled:cursor-default"
                >
                  <MatchBadge score={score} loading={isMatchScoreLoading && score === null} />
                </button>
              </div>

              {/* Status badges */}
              {(activelyHiring || easyApply || topApplicantSignal) && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {activelyHiring && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" aria-hidden />
                      Actively recruiting
                    </span>
                  )}
                  {easyApply && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200">
                      <Zap className="h-3 w-3" aria-hidden />
                      Easy Apply
                    </span>
                  )}
                  {topApplicantSignal && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                      <Trophy className="h-3 w-3" aria-hidden />
                      Top Applicant
                    </span>
                  )}
                </div>
              )}

              {/* Sponsorship row — factual data, JD negative language always wins */}
              {sponsorshipDisplay && (
                <div className="mt-2.5 flex items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                    sponsorshipDisplay.tone === "emerald"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      : sponsorshipDisplay.tone === "sky"
                        ? "bg-sky-50 text-sky-700 ring-sky-200"
                        : "bg-rose-50 text-rose-600 ring-rose-200"
                  )}>
                    {sponsorshipDisplay.tone !== "rose"
                      ? <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
                      : <ShieldX className="h-3 w-3 shrink-0" aria-hidden />
                    }
                    {sponsorshipDisplay.label}
                  </span>
                  <span className="text-[11px] text-slate-400">{sponsorshipDisplay.sub}</span>
                </div>
              )}

              {/* Skills — or preview description when no diff data */}
              {(matchedSkills.length > 0 || missingSkills.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {matchedVisible.map((skill) => (
                    <span
                      key={`m-${job.id}-${skill}`}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200"
                    >
                      <Check className="h-3 w-3" aria-hidden />
                      {skill}
                    </span>
                  ))}
                  {matchedExtra > 0 && (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 ring-1 ring-emerald-200">
                      +{matchedExtra}
                    </span>
                  )}
                  {missingVisible.map((skill) => (
                    <span
                      key={`x-${job.id}-${skill}`}
                      className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-600 ring-1 ring-rose-200"
                    >
                      <span className="text-[12px] leading-none">+</span>
                      {skill}
                    </span>
                  ))}
                  {missingExtra > 0 && (
                    <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-500 ring-1 ring-rose-200">
                      +{missingExtra} to learn
                    </span>
                  )}
                </div>
              )}

              {/* Preview description — only when no skills to diff */}
              {matchedSkills.length === 0 && missingSkills.length === 0 && cardView.preview_description && (
                <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-slate-500">
                  {cardView.preview_description}
                </p>
              )}
            </div>
          </div>

          {/* Footer: posted + actions */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", postedDotColor)} aria-hidden />
              <span className={cn("text-[12px] font-medium", postedTextColor)}>{postedAt}</span>
            </span>

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
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition",
                  saved
                    ? "border-amber-200 bg-amber-50 text-amber-600"
                    : "border-slate-200 bg-white text-slate-400 hover:border-indigo-200 hover:text-indigo-500"
                )}
              >
                <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
              </button>
              <button
                type="button"
                onClick={() => router.push(detailHref)}
                aria-label="View details"
                className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-[12px] font-semibold text-indigo-600 transition hover:bg-indigo-100"
              >
                View
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Hover expansion (dark panel) ── */}
        <div className="overflow-hidden">
          <div className="max-h-0 translate-y-1 opacity-0 transition-all duration-200 ease-out group-hover:max-h-[380px] group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:max-h-[380px] group-focus-within:translate-y-0 group-focus-within:opacity-100">
            <div className="bg-slate-950 px-5 pb-4 pt-4 sm:px-6">

              {/* Info tiles */}
              <div className={cn(
                "grid gap-3",
                hasH1bData && showCompanySnippet ? "lg:grid-cols-[140px_200px_1fr_160px]"
                : hasH1bData                     ? "lg:grid-cols-[140px_200px_1fr]"
                : showCompanySnippet              ? "lg:grid-cols-[140px_1fr_160px]"
                :                                  "lg:grid-cols-[140px_1fr]"
              )}>

                {/* Col 1: Quick stats */}
                <div className="space-y-2.5 rounded-xl bg-white/5 p-3">
                  {salaryRange && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Salary</p>
                      <p className="mt-0.5 text-[13px] font-bold text-emerald-400">{salaryRange}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Posted</p>
                    <p className="mt-0.5 text-[12px] font-medium text-slate-300">{postedAt}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Type</p>
                    <p className="mt-0.5 text-[12px] font-medium text-slate-300">{employmentType}</p>
                  </div>
                </div>

                {/* Col 2: H1B / LCA intel — only when data exists and not blocked by JD */}
                {hasH1bData && (
                  <div className="rounded-xl bg-white/5 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">H-1B Intel</p>

                    {/* Status badge */}
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      jdBlocksSponsorship
                        ? "bg-rose-500/15 text-rose-400"
                        : companySponsorsH1b
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-sky-500/15 text-sky-400"
                    )}>
                      <ShieldCheck className="h-3 w-3" aria-hidden />
                      {jdBlocksSponsorship
                        ? "Posting says no sponsorship"
                        : companySponsorsH1b
                          ? "Active H-1B sponsor"
                          : "Historical signal"}
                    </span>

                    {/* Confidence bar */}
                    {!jdBlocksSponsorship && sponsorConfidence > 0 && (
                      <div className="mt-2.5">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[10px] text-slate-500">Confidence</span>
                          <span className="text-[10px] font-semibold tabular-nums text-slate-400">{sponsorConfidence}%</span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={cn("h-full rounded-full", sponsorConfidence >= 70 ? "bg-emerald-500" : sponsorConfidence >= 40 ? "bg-sky-500" : "bg-amber-500")}
                            style={{ width: `${sponsorConfidence}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Petition counts */}
                    {!jdBlocksSponsorship && (h1bCount1yr > 0 || h1bCount3yr > 0) && (
                      <div className="mt-2.5 space-y-1.5 border-t border-white/10 pt-2.5">
                        {h1bCount1yr > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-slate-500">Last year</span>
                            <span className="text-[11px] font-bold tabular-nums text-white">{h1bCount1yr.toLocaleString()}</span>
                          </div>
                        )}
                        {h1bCount3yr > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-slate-500">3-year total</span>
                            <span className="text-[11px] font-bold tabular-nums text-white">{h1bCount3yr.toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <p className="mt-2.5 text-[10px] text-slate-600">Source: USCIS petition records</p>
                  </div>
                )}

                {/* Col 2: Why it's a match */}
                <div className="rounded-xl bg-white/5 p-3">
                  <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-400" aria-hidden />
                    Why it&apos;s a match
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {whyBullets.map((bullet, i) => (
                      <p key={`${job.id}-b-${i}`} className="flex items-start gap-2 text-[12px] leading-5 text-slate-300">
                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden />
                        {bullet}
                      </p>
                    ))}
                  </div>

                  {/* Tailor CTA */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/resume/analyze/${job.id}`) }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:from-indigo-600 hover:to-violet-700"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden />
                    Tailor Resume
                  </button>
                </div>

                {/* Col 3: Company snapshot (when available) */}
                {showCompanySnippet && (
                  <div className="rounded-xl bg-white/5 p-3">
                    <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white">
                      <Building2 className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      {companyName}
                    </p>
                    {companySummary && (
                      <p className="mt-1.5 line-clamp-3 text-[11px] leading-5 text-slate-400">
                        {companySummary}
                      </p>
                    )}
                    {(companySector || companySize) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {companySector && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                            {companySector}
                          </span>
                        )}
                        {companySize && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                            {companySize}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom action bar */}
              <div
                className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row sm:items-center sm:justify-between"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition",
                      saved
                        ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
                        : "bg-white/10 text-slate-300 hover:bg-white/15 hover:text-white"
                    )}
                  >
                    <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
                    {saved ? "Saved" : "Save"}
                  </button>
                </div>

                <div className="flex gap-2">
                  {canAutofill ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/autofill/fill/${job.id}`) }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-white/10"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden />
                      Autofill & Apply
                    </button>
                  ) : (
                    <a
                      href={job.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-white/10"
                    >
                      <Zap className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                      Quick Apply
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => router.push(detailHref)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r px-3.5 py-2 text-[12px] font-semibold text-white transition",
                      scoreGradient(score)
                    )}
                  >
                    View Details
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>
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
