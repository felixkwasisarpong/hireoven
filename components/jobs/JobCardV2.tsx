"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Bookmark,
  Briefcase,
  Building2,
  Linkedin,
  MapPin,
  Repeat2,
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
// Import only from view-model — never from the normalization index, which
// transitively pulls in normalize.ts → @anthropic-ai/sdk and breaks the browser bundle.
import {
  formatEmploymentLabel,
  formatSalaryLabel,
} from "@/lib/jobs/normalization/view-model"
import type { JobCardViewModel } from "@/lib/jobs/normalization/types"
import {
  employerLikelySponsorsH1b,
  resolveH1BSponsorshipDisplay,
  type SponsorshipVisaCardLabel,
} from "@/lib/jobs/sponsorship-employer-signal"
import {
  isStaffingIntermediaryListing,
  readHiringEntitySignalFromRawData,
  resolveDisplayCompanyName,
} from "@/lib/jobs/hiring-entity"
import {
  getMatchCardLabel,
  getMatchVerdict,
  hasUsableMatchScore,
  resolveOverallMatchScore,
} from "@/lib/jobs/match-score-display"
import { buildTopApplicantOpportunityBadgeTitle } from "@/lib/jobs/job-card-badges"
import {
  JOB_APPLICATION_SAVED_EVENT,
  JOB_APPLICATION_UNSAVED_EVENT,
  fetchJobSavedState,
  saveJobToPipeline,
} from "@/lib/applications/save-job-client"
import { getApplyVariant, getApplyVariantLabel } from "@/lib/jobs/apply-cta"
import {
  readJobRepostCount,
  resolveGhostRepostSignals,
  type GhostRepostSignal,
} from "@/lib/jobs/ghost-repost-flags"
import { jobSourceFallbackLogo } from "@/lib/jobs/source-fallback-logo"
import { useToast } from "@/components/ui/ToastProvider"
import { MatchScoreBreakdownPopover } from "@/components/matching/MatchScoreBreakdownPopover"
import { cn } from "@/lib/utils"
import type { JobMatchScore, JobWithCompany, JobWithMatchScore } from "@/types"

type RawRecord = Record<string, unknown>

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

function equalsIgnoreCase(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
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

function resolveVisaCardLabel(
  job: JobWithCompany | JobWithMatchScore,
  normLabel: SponsorshipVisaCardLabel
): SponsorshipVisaCardLabel {
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


// ---------------------------------------------------------------------------
// Score-derived styles
// ---------------------------------------------------------------------------

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
  if (l === "intern" || l === "junior") return "bg-sky-500 text-white"
  if (l === "mid") return "bg-indigo-500 text-white"
  if (l === "senior") return "bg-violet-600 text-white"
  return "bg-purple-600 text-white"
}

function ghostSignalPillClass(tone: GhostRepostSignal["tone"]): string {
  if (tone === "critical") return "bg-rose-50 text-rose-700 ring-rose-200"
  return "bg-amber-50 text-amber-700 ring-amber-200"
}

// ---------------------------------------------------------------------------
// Match ring
// ---------------------------------------------------------------------------

const RING_SIZE = 62
const RING_SW = 5.5
const RING_R = (RING_SIZE - RING_SW) / 2       // 28.25
const RING_CX = RING_SIZE / 2                   // 31
const RING_CIRC = 2 * Math.PI * RING_R          // ≈ 177.5

function scoreRingColor(score: number | null): string {
  if (score == null) return "#94a3b8"   // slate-400
  if (score >= 85)   return "#10b981"   // emerald-500
  if (score >= 70)   return "#3b82f6"   // blue-500
  if (score >= 55)   return "#f59e0b"   // amber-500
  return "#64748b"                       // slate-500
}

function MatchBadge({ score, loading }: { score: number | null; loading: boolean }) {
  const progress   = score !== null ? Math.max(0, Math.min(100, score)) / 100 : 0
  const dashOffset = RING_CIRC * (1 - progress)
  const ringColor  = scoreRingColor(score)
  const verdict    = getMatchVerdict(score)

  if (loading) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <div className="flex h-[62px] w-[62px] items-center justify-center">
          <svg width={RING_SIZE} height={RING_SIZE} className="animate-spin">
            <circle
              cx={RING_CX} cy={RING_CX} r={RING_R}
              fill="none" stroke="#e2e8f0" strokeWidth={RING_SW}
            />
            <circle
              cx={RING_CX} cy={RING_CX} r={RING_R}
              fill="none" stroke="#94a3b8" strokeWidth={RING_SW}
              strokeLinecap="round"
              strokeDasharray={`${RING_CIRC * 0.22} ${RING_CIRC * 0.78}`}
            />
          </svg>
        </div>
        <span className="text-[10px] font-medium text-slate-400">Scoring…</span>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="relative flex h-[62px] w-[62px] items-center justify-center">
        <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90" aria-hidden>
          <circle
            cx={RING_CX} cy={RING_CX} r={RING_R}
            fill="none" stroke="#e2e8f0" strokeWidth={RING_SW}
          />
          <circle
            cx={RING_CX} cy={RING_CX} r={RING_R}
            fill="none"
            stroke={ringColor}
            strokeWidth={RING_SW}
            strokeLinecap="round"
            strokeDasharray={RING_CIRC}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.45s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[17px] font-extrabold leading-none tabular-nums text-slate-900">
            {score ?? "—"}
          </span>
          <span className="mt-0.5 text-[8.5px] font-bold uppercase tracking-[0.16em] text-slate-400">
            match
          </span>
        </div>
      </div>
      <span className={cn("text-center text-[10px] font-semibold leading-tight", verdict.colorClass)}>
        {verdict.label}
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
  enableHoverEffects?: boolean
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
  enableHoverEffects = true,
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
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const matchBadgeRef = useRef<HTMLButtonElement | null>(null)

  const { attachRef: h1bAttachRef, prediction: h1bPrediction, isLoading: h1bIsLoading } = useH1BPrediction(job.id)
  const now = nowProp ?? Date.now()
  const router = useRouter()
  const detailHref = `/dashboard/jobs/${job.id}`
  const { primaryResume } = useResumeContext()
  void (typeof hasPrimaryResume === "boolean" ? hasPrimaryResume : Boolean(primaryResume))
  void isBestMatch

  const raw = useMemo(() => readRawRecord(job), [job])
  const rawMatchScore = matchScoreProp ?? ("match_score" in job ? (job.match_score ?? null) : null)
  const resolvedMatchScore = hasUsableMatchScore(rawMatchScore) ? rawMatchScore : null
  const score = resolveOverallMatchScore({
    preferredScore: resolvedMatchScore,
  })
  const matchLabel = getMatchCardLabel(score)
  const showMatchReasoning = score !== null

  // Use server-precomputed card view. Never call resolveJobCardView() on the client —
  // it chains into normalize.ts which imports @anthropic-ai/sdk and crashes the browser.
  // The API always provides card_view; when missing (e.g. stale cache) fall back to
  // raw job fields which are always available.
  const cardView = useMemo((): JobCardViewModel => {
    if ("card_view" in job && job.card_view) return job.card_view as JobCardViewModel
    return {
      title: job.title,
      location: job.location ?? null,
      salary_label: formatSalaryLabel(job.salary_min, job.salary_max, job.salary_currency) ?? null,
      employment_label: formatEmploymentLabel(job.employment_type) ?? null,
      seniority_label: null,
      preview_description: null,
      skills: [],
      skill_groups: { programmingLanguages:[], frameworks:[], cloud:[], databases:[], devops:[], aiMl:[], data:[], security:[], engineering:[], testing:[], networking:[], media:[], healthcare:[], science:[], softSkills:[] },
      sponsorship_badge: null,
      visa_card_label: null,
      show_visa_drawer: false,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id])
  const displayTitle = cardView.title
  const hiringEntitySignal = useMemo(
    () => readHiringEntitySignalFromRawData(raw),
    [raw]
  )
  const staffingIntermediary = isStaffingIntermediaryListing({ rawData: raw })
  const companyName = resolveDisplayCompanyName({
    companyName: job.company?.name ?? null,
    rawData: raw,
  })
  const staffingCompanyName = hiringEntitySignal?.staffing_company_name ?? job.company?.name ?? null
  const showingEndClientName =
    staffingIntermediary &&
    Boolean(hiringEntitySignal?.end_client_name) &&
    !equalsIgnoreCase(companyName, staffingCompanyName)
  const rawCompanyDomain = job.company?.domain ?? null
  const rawCompanyLogoUrl = job.company?.logo_url ?? pickRawString(raw, ["companyLogo", "company_logo"]) ?? null
  const sourceFallback = jobSourceFallbackLogo(job, rawCompanyDomain, rawCompanyLogoUrl)
  const companyDomain = sourceFallback?.domain ?? rawCompanyDomain
  const companyLogoUrl = sourceFallback?.logoUrl ?? rawCompanyLogoUrl
  const companyProfileHref =
    job.company?.id && !showingEndClientName ? `/companies/${job.company.id}` : null

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
  const h1bCount1yr = staffingIntermediary ? 0 : job.company?.h1b_sponsor_count_1yr ?? 0
  const h1bCount3yr = staffingIntermediary ? 0 : job.company?.h1b_sponsor_count_3yr ?? 0
  const sponsorConfidence = staffingIntermediary ? 0 : job.company?.sponsorship_confidence ?? 0
  const companySponsorsH1b = !staffingIntermediary && job.company?.sponsors_h1b === true
  const hasH1bData = companySponsorsH1b || h1bCount1yr > 0 || job.sponsors_h1b === true

  const easyApply = pickRawBoolean(raw, ["easyApply", "easy_apply"]) ?? false
  const repostCount = readJobRepostCount(job)
  const ghostRepostSignals = useMemo(
    () => resolveGhostRepostSignals({ freshnessDays, repostCount }),
    [freshnessDays, repostCount]
  )

  // Actively recruiting: raw crawler boolean OR detected from title/description text
  const activelyHiring = useMemo(() => {
    if (pickRawBoolean(raw, ["activelyHiring", "actively_hiring"]) === true) return true
    const haystack = [
      job.title ?? "",
      cardView.preview_description ?? "",
      pickRawString(raw, ["sponsorshipSignal", "sponsorship_signal"]) ?? "",
    ].join(" ")
    // Mirrors chrome-extension/src/extractors/apex-extractor.ts ACTIVELY_HIRING_RE.
    return /\b(?:actively\s+(?:recruiting|hiring|seeking|reviewing\s+(?:applicants?|applications?|candidates?))|urgently?\s+hiring|hiring\s+now|now\s+hiring|immediate(?:ly)?\s+(?:hire|hiring|need|opening)|urgent(?:ly)?\s+(?:hiring|need)|high(?:ly)?\s+priority\s+role)\b/i.test(haystack)
  }, [raw, job.title, cardView.preview_description])

  // Three-way classification: linkedin, autofill, external.
  const applyVariant = getApplyVariant(job.apply_url)
  const applyCtaLabel = getApplyVariantLabel(applyVariant)
  const isLinkedIn = applyVariant === "linkedin"
  const isAtsApplyLink = applyVariant === "autofill"


  const visaCardLabel = useMemo(
    () => resolveVisaCardLabel(job, cardView.visa_card_label),
    [job, cardView.visa_card_label]
  )
  // JD says "no sponsorship" → suppress all positive company signals for this role.
  // Only trust H1B/LCA data when the posting has no explicit negative language.
  const jdBlocksSponsorship =
    visaCardLabel === "No sponsorship" || job.requires_authorization === true

  const sponsorshipDisplay = useMemo(
    () => resolveH1BSponsorshipDisplay(job, { visaCardLabel }),
    [job, visaCardLabel]
  )
  const sponsorshipStrengthText =
    sponsorshipDisplay?.strength === "strong"
      ? "Strong signal"
      : sponsorshipDisplay?.strength === "moderate"
        ? "Moderate signal"
        : sponsorshipDisplay?.strength === "limited"
          ? "Limited signal"
          : null


  const rawTopApplicantFlag = pickRawBoolean(raw, ["topApplicantSignal", "top_applicant_signal"]) === true
  const topApplicantSignal = useMemo(() => {
    if (!rawTopApplicantFlag) return false
    const { show } = buildTopApplicantOpportunityBadgeTitle(job, score)
    return show
  }, [rawTopApplicantFlag, job, score])

  const whyBullets = useMemo(() => {
    const bullets: string[] = []
    if (score !== null) {
      if (score >= 85) bullets.push("Excellent match based on your resume and profile.")
      else if (score >= 70) bullets.push("Strong overall alignment for this role.")
      else if (score >= 55) bullets.push("Moderate match — worth tailoring your resume.")
    }
    if (visaCardLabel === "Sponsors" || visaCardLabel === "Historical sponsorship signal") {
      bullets.push("Favorable sponsorship signals vs similar listings.")
    }
    if (topApplicantSignal || activelyHiring) {
      bullets.push("Fresh posting — good window to apply early.")
    }
    if (bullets.length === 0) bullets.push("Role signals align with your search preferences.")
    return bullets.slice(0, 2)
  }, [score, visaCardLabel, topApplicantSignal, activelyHiring])

  useEffect(() => {
    let cancelled = false
    void fetchJobSavedState(job.id).then((v) => { if (!cancelled) setSaved(v) })
    return () => { cancelled = true }
  }, [job.id])

  useEffect(() => {
    function onSaved(e: Event) {
      if ((e as CustomEvent<{ jobId?: string }>).detail?.jobId === job.id) setSaved(true)
    }
    function onUnsaved(e: Event) {
      if ((e as CustomEvent<{ jobId?: string }>).detail?.jobId === job.id) setSaved(false)
    }
    window.addEventListener(JOB_APPLICATION_SAVED_EVENT, onSaved as EventListener)
    window.addEventListener(JOB_APPLICATION_UNSAVED_EVENT, onUnsaved as EventListener)
    return () => {
      window.removeEventListener(JOB_APPLICATION_SAVED_EVENT, onSaved as EventListener)
      window.removeEventListener(JOB_APPLICATION_UNSAVED_EVENT, onUnsaved as EventListener)
    }
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

  function openFullAnalysis() {
    if (resolvedMatchScore?.score_method === "deep") {
      router.push(`/dashboard/resume/analyze/${job.id}`)
    } else {
      setDrawerOpen(true)
    }
  }

  function onMatchBadgeClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (score === null) return
    if (resolvedMatchScore) {
      setBreakdownOpen((v) => !v)
    } else {
      openFullAnalysis()
    }
  }

  // Work mode pill styling
  const workModePill =
    workMode === "Remote"
      ? "bg-emerald-500 text-white"
      : workMode === "Hybrid"
        ? "bg-sky-500 text-white"
        : "bg-slate-500 text-white"

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
          "group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
          enableHoverEffects && "hover:-translate-y-0.5 hover:border-transparent hover:shadow-[0_12px_32px_rgba(15,23,42,0.12)]",
          enableHoverEffects && scoreHoverRing(score)
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
              className="h-20 w-20 shrink-0 rounded-xl border border-slate-200 bg-slate-50 sm:h-24 sm:w-24"
            />

            {/* Main info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-2 text-[17px] font-bold leading-[1.35] tracking-[-0.01em] text-slate-950">
                    {displayTitle}
                  </h3>

                  {/* Company row */}
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {companyProfileHref ? (
                      <Link
                        href={companyProfileHref}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          "text-[13px] font-semibold text-slate-600 transition",
                          enableHoverEffects && "hover:text-[#FF5C18] hover:underline"
                        )}
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
                    {showingEndClientName && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        via staffing intermediary
                      </span>
                    )}
                  </div>

                  {/* Location · mode · seniority · type · salary */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {job.location?.trim() && (
                      <span className="inline-flex items-center gap-1 text-[13px] text-slate-500">
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
                    <span className="inline-flex items-center gap-1 text-[13px] text-slate-500">
                      <Briefcase className="h-3 w-3 text-slate-400" aria-hidden />
                      {employmentType}
                    </span>
                    {salaryRange && (
                      <span className="inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums text-emerald-600">
                        <Banknote className="h-3 w-3" aria-hidden />
                        {salaryRange}
                      </span>
                    )}
                  </div>
                </div>

                {/* Match badge */}
                <button
                  ref={matchBadgeRef}
                  type="button"
                  onClick={onMatchBadgeClick}
                  disabled={score === null && !isMatchScoreLoading}
                  aria-label={matchLabel}
                  aria-haspopup="dialog"
                  aria-expanded={breakdownOpen}
                  className={cn(
                    "shrink-0 rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-default",
                    enableHoverEffects && "hover:opacity-90"
                  )}
                >
                  <MatchBadge score={score} loading={isMatchScoreLoading && score === null} />
                </button>
              </div>

              {/* Status badges */}
              {(activelyHiring || easyApply || topApplicantSignal || ghostRepostSignals.length > 0) && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {activelyHiring && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/70" aria-hidden />
                      Actively recruiting
                    </span>
                  )}
                  {easyApply && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-2.5 py-1 text-[11px] font-semibold text-white">
                      <Zap className="h-3 w-3" aria-hidden />
                      Easy Apply
                    </span>
                  )}
                  {topApplicantSignal && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white">
                      <Trophy className="h-3 w-3" aria-hidden />
                      Top Applicant
                    </span>
                  )}
                  {ghostRepostSignals.map((signal) => (
                    <span
                      key={`${signal.kind}:${signal.label}`}
                      title={signal.detail}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                        ghostSignalPillClass(signal.tone)
                      )}
                    >
                      {signal.kind === "stale"
                        ? <AlertTriangle className="h-3 w-3" aria-hidden />
                        : <Repeat2 className="h-3 w-3" aria-hidden />
                      }
                      {signal.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Sponsorship row — factual data, JD negative language always wins */}
              {sponsorshipDisplay && (
                <div className="mt-2.5 flex items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white",
                    sponsorshipDisplay.tone === "emerald"
                      ? "bg-emerald-500"
                      : sponsorshipDisplay.tone === "sky"
                        ? "bg-sky-500"
                        : sponsorshipDisplay.tone === "amber"
                          ? "bg-amber-500"
                        : "bg-rose-500"
                  )}>
                    {sponsorshipDisplay.tone !== "rose"
                      ? <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
                      : <ShieldX className="h-3 w-3 shrink-0" aria-hidden />
                    }
                    {sponsorshipDisplay.label}
                  </span>
                  <span className="text-[11px] text-slate-400">{sponsorshipDisplay.sublabel}</span>
                </div>
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
              className={cn(
                "flex items-center gap-1.5 transition-opacity duration-150",
                enableHoverEffects &&
                  "group-hover:pointer-events-none group-hover:opacity-0 group-focus-within:pointer-events-none group-focus-within:opacity-0"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Tertiary: Save (single canonical instance, icon only) */}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                aria-label={saved ? "Saved" : "Save"}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition",
                  saved
                    ? "border-orange-200 bg-orange-50 text-[#FF5C18]"
                    : cn(
                        "border-slate-200 bg-white text-slate-400",
                        enableHoverEffects && "hover:border-orange-200 hover:text-[#FF5C18]"
                      )
                )}
              >
                <Bookmark className={cn("h-4 w-4", saved && "fill-current")} />
              </button>
              {/* Secondary: View (neutral outline) — card body is also clickable */}
              <button
                type="button"
                onClick={() => router.push(detailHref)}
                aria-label="View details"
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600 transition",
                  enableHoverEffects && "hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                View
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Hover expansion (dark panel) ── */}
        <div className="overflow-hidden">
          <div
            className={cn(
              "transition-all duration-200 ease-out",
              enableHoverEffects
                ? "max-h-0 translate-y-1 opacity-0 group-hover:max-h-[380px] group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:max-h-[380px] group-focus-within:translate-y-0 group-focus-within:opacity-100"
                : "hidden"
            )}
          >
            <div className="bg-slate-950 px-5 pb-4 pt-4 sm:px-6">

              {/* Info tiles */}
              <div className={cn(
                "grid gap-3",
                showMatchReasoning
                  ? hasH1bData && showCompanySnippet ? "lg:grid-cols-[140px_200px_1fr_160px]"
                  : hasH1bData                       ? "lg:grid-cols-[140px_200px_1fr]"
                  : showCompanySnippet               ? "lg:grid-cols-[140px_1fr_160px]"
                  :                                    "lg:grid-cols-[140px_1fr]"
                  : hasH1bData && showCompanySnippet ? "lg:grid-cols-[140px_200px_160px]"
                  : hasH1bData                       ? "lg:grid-cols-[140px_200px]"
                  : showCompanySnippet               ? "lg:grid-cols-[140px_160px]"
                  :                                    "lg:grid-cols-[140px]"
              )}>

                {/* Col 1: Quick stats */}
                <div className="space-y-2.5 rounded-xl bg-white/5 p-3">
                  {salaryRange && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Salary</p>
                      <p className="mt-0.5 text-[13px] font-bold tabular-nums text-emerald-400">{salaryRange}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Posted</p>
                    <p className="mt-0.5 text-[12px] font-medium tabular-nums text-slate-300">{postedAt}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Type</p>
                    <p className="mt-0.5 text-[12px] font-medium text-slate-300">{employmentType}</p>
                  </div>
                </div>

                {/* Col 2: H1B / LCA intel — only when data exists and not blocked by JD */}
                {hasH1bData && (
                  <div className="rounded-xl bg-white/5 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">H-1B Intel</p>

                    {/* Status badge */}
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      sponsorshipDisplay?.tone === "rose" || jdBlocksSponsorship
                        ? "bg-rose-500/15 text-rose-400"
                        : sponsorshipDisplay?.tone === "emerald"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : sponsorshipDisplay?.tone === "amber"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-sky-500/15 text-sky-400"
                    )}>
                      {sponsorshipDisplay?.tone === "rose" || jdBlocksSponsorship ? (
                        <ShieldX className="h-3 w-3" aria-hidden />
                      ) : (
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                      )}
                      {sponsorshipDisplay?.tone === "rose" || jdBlocksSponsorship
                        ? "Posting says no sponsorship"
                        : sponsorshipStrengthText
                          ? `${sponsorshipDisplay?.label} · ${sponsorshipStrengthText}`
                          : sponsorshipDisplay?.label ?? "Historical signal"}
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

                {/* Col 2: Why it's a match (only when score is available) */}
                {showMatchReasoning && (
                  <div className="rounded-xl bg-white/5 p-3">
                    <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white">
                      <Sparkles className="h-3.5 w-3.5 text-[#FF7D45]" aria-hidden />
                      Why it&apos;s a match
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {whyBullets.map((bullet, i) => (
                        <p key={`${job.id}-b-${i}`} className="flex items-start gap-2 text-[12px] leading-5 text-slate-300">
                          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#FF5C18]" aria-hidden />
                          {bullet}
                        </p>
                      ))}
                    </div>

                    {/* Tailor CTA */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/resume/analyze/${job.id}`) }}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
                    >
                      <Sparkles className="h-3 w-3 text-[#FF7D45]" aria-hidden />
                      Tailor Resume
                    </button>
                  </div>
                )}

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

              {/* Bottom action bar — one filled primary (Apply), one outline
                  secondary (View Details). Save lives once on the collapsed card. */}
              <div
                className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row sm:items-center sm:justify-end"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => router.push(detailHref)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-white/25 bg-transparent px-4 text-[13px] font-semibold text-white transition hover:bg-white/10"
                >
                  View Details
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
                <a
                  href={job.apply_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-bold text-primary-foreground shadow-[0_4px_16px_rgba(255,92,24,0.35)] transition hover:bg-primary-hover active:scale-[0.98]"
                >
                  {isLinkedIn ? (
                    <Linkedin className="h-3.5 w-3.5" aria-hidden />
                  ) : isAtsApplyLink ? (
                    <Zap className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {applyCtaLabel}
                </a>
              </div>
            </div>
          </div>
        </div>
      </article>

      <MatchScoreBreakdownPopover
        score={resolvedMatchScore}
        open={breakdownOpen}
        anchorRef={matchBadgeRef}
        onClose={() => setBreakdownOpen(false)}
        onSeeFullAnalysis={() => {
          setBreakdownOpen(false)
          openFullAnalysis()
        }}
      />

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
