"use client"

import { useEffect, useMemo, useState } from "react"
import { Bookmark, ExternalLink, Gem, MapPin, TrendingUp, Trophy } from "lucide-react"
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
import { VisaFitBadge } from "@/components/jobs/card/VisaFitBadge"
import { SalaryIntelBadge } from "@/components/jobs/card/SalaryIntelBadge"
import { GhostRiskBadge } from "@/components/jobs/card/GhostRiskBadge"
import { ApplicationVerdictPill } from "@/components/jobs/card/ApplicationVerdictPill"
import { SponsorshipBlockerBadge } from "@/components/jobs/card/SponsorshipBlockerBadge"
import { JobCardEvidenceFactChips } from "@/components/jobs/card/JobCardEvidenceFactChips"
import { PostedTimeLabel } from "@/components/jobs/card/PostedTimeLabel"
import { buildJobCardFactList, buildJobEvidenceFacts } from "@/lib/jobs/job-evidence-facts"
import {
  buildSalaryStrongBadgeTitle,
  buildTopApplicantOpportunityBadgeTitle,
  shouldShowSalaryStrongBadge,
} from "@/lib/jobs/job-card-badges"
import type { JobMatchScore, JobWithCompany, JobWithMatchScore } from "@/types"

function normalizeScore(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(numeric)) return null
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

function MatchRing({ score, loading }: { score: number | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="h-[52px] w-[52px] animate-pulse rounded-full bg-slate-100" />
        <span className="text-[10px] text-slate-400">Scoring…</span>
      </div>
    )
  }
  if (score === null) return null

  const radius = 20
  const circumference = 2 * Math.PI * radius
  const filled = (score / 100) * circumference
  const color = score >= 80 ? "#059669" : score >= 60 ? "#2563EB" : "#EA580C"
  const label = score >= 80 ? "Great Match" : score >= 60 ? "Good Match" : "Fair Match"

  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <div className="relative flex h-[52px] w-[52px] items-center justify-center">
        <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90" aria-hidden>
          <circle cx="26" cy="26" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="4" />
          <circle
            cx="26" cy="26" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeDasharray={`${filled} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute text-sm font-bold text-slate-900">{score}%</span>
      </div>
      <span className="text-[10px] font-semibold leading-none" style={{ color }}>{label}</span>
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

  const resolvedMatchScore = matchScoreProp ?? ("match_score" in job ? (job.match_score ?? null) : null)
  const score = normalizeScore(resolvedMatchScore?.overall_score)

  const cardView = resolveJobCardView(job)
  const displayTitle = cardView.title

  const companyName = job.company?.name ?? "Unknown company"
  const companyDomain = job.company?.domain ?? null
  const companyLogoUrl = job.company?.logo_url ?? null
  const companyProfileHref = job.company?.id ? `/companies/${job.company.id}` : null

  const intel = useMemo(() => getJobIntelligence(job), [job])

  const hasBlocker = intel.visa?.blockers?.some((b) => b.detected) ?? false
  const showSponsorshipPanel =
    showVisaSignals &&
    (employerLikelySponsorsH1b(job) || (!job.requires_authorization && effectiveEmployerSponsorshipScore(job) >= 55))

  const evidenceFacts = useMemo(() => buildJobEvidenceFacts(job), [job])
  const jobCardFactItems = useMemo(
    () => buildJobCardFactList(evidenceFacts, 4).filter(
      (item) => item.id !== "location" || !job.location?.trim()
    ),
    [evidenceFacts, job.location]
  )
  const topApplicantBadge = useMemo(
    () => buildTopApplicantOpportunityBadgeTitle(job, score),
    [job, score]
  )
  const showSalaryStrong = shouldShowSalaryStrongBadge(evidenceFacts)
  const salaryStrongTitle = useMemo(() => buildSalaryStrongBadgeTitle(evidenceFacts), [evidenceFacts])

  useEffect(() => {
    let cancelled = false
    void fetchJobSavedState(job.id).then((isSaved) => {
      if (!cancelled) setSaved(isSaved)
    })
    return () => { cancelled = true }
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
    // The whole card navigates via router.push, so Next cannot infer a prefetch
    // like it can for <Link>. Prefetch visible feed cards to reduce click delay.
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

  const showScorePanel = score !== null || (showResumeSignal && isMatchScoreLoading)

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
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all hover:border-orange-200 hover:shadow-[0_2px_8px_rgba(234,88,12,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600/20"
      >
        {/* Left accent bar — premium hover signal */}
        <div className="absolute inset-y-0 left-0 w-0.5 bg-orange-600 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />

        {/* Header */}
        <div className="flex min-w-0 flex-col gap-4 px-5 pt-5 pb-4 sm:flex-row sm:items-start">
          <CompanyLogo
            companyName={companyName}
            domain={companyDomain}
            logoUrl={companyLogoUrl}
            priority={priorityLogo}
            className="h-12 w-12 flex-shrink-0 rounded-xl border border-slate-100 bg-slate-50 object-contain p-1"
          />

          <div className="min-w-0 flex-1">
            {/* Title + top-match badge */}
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-slate-950 transition-colors group-hover:text-orange-600">
                {displayTitle}
              </h3>
              {isBestMatch && (
                <span className="mt-0.5 inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-amber-900">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white">
                    <Trophy className="h-2.5 w-2.5" aria-hidden />
                  </span>
                  Top Match
                </span>
              )}
            </div>

            {/* Company + posted time */}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {companyProfileHref ? (
                <Link
                  href={companyProfileHref}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[13px] font-semibold text-slate-700 transition hover:text-orange-600 hover:underline"
                >
                  {companyName}
                </Link>
              ) : (
                <span className="text-[13px] font-semibold text-slate-700">{companyName}</span>
              )}
              <span aria-hidden className="text-slate-300">·</span>
              <PostedTimeLabel firstDetectedAt={job.first_detected_at} now={now} />
            </div>

            {/* Meta row: clean location + evidence chips for type / mode / salary */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {job.location?.trim() && (
                <span className="inline-flex items-center gap-1 text-[12.5px] text-slate-500">
                  <MapPin className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                  {job.location}
                </span>
              )}
              {jobCardFactItems.length > 0 && (
                <JobCardEvidenceFactChips jobId={job.id} items={jobCardFactItems} />
              )}
            </div>

            {/* Top applicant opportunity — surfaced here so it gets seen */}
            {topApplicantBadge.show && (
              <div className="mt-2.5">
                <span
                  title={topApplicantBadge.title}
                  className="inline-flex items-center gap-1.5 rounded-md bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700"
                >
                  <Gem className="h-3 w-3 shrink-0" aria-hidden />
                  Top Applicant Opportunity
                </span>
              </div>
            )}
          </div>

          {/* Match ring */}
          {showScorePanel && (
            <button
              type="button"
              onClick={openMatchDetail}
              disabled={score === null && !isMatchScoreLoading}
              className="flex flex-col items-center self-start rounded-xl p-1 transition hover:bg-orange-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600/25 sm:ml-2"
              aria-label="View match score"
            >
              <MatchRing score={score} loading={isMatchScoreLoading && score === null} />
            </button>
          )}
        </div>

        {/* Intelligence strip */}
        <div
          className="flex min-h-[40px] flex-wrap items-center gap-2 border-t border-slate-100 bg-white px-5 py-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Salary strong */}
          {showSalaryStrong && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900"
              title={salaryStrongTitle}
            >
              <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />
              Salary strong
            </span>
          )}

          {/* Visa fit */}
          {showVisaSignals && intel.visa?.label && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (showSponsorshipPanel) setH1bDrawerOpen(true) }}
              className="focus-visible:outline-none"
              aria-label="Open visa fit details"
            >
              <VisaFitBadge label={intel.visa.label} score={intel.visa.visaFitScore} />
            </button>
          )}

          {/* Sponsorship blocker */}
          {hasBlocker && (
            <SponsorshipBlockerBadge blockers={intel.visa?.blockers} />
          )}

          {/* LCA salary alignment */}
          {intel.lcaSalary?.comparisonLabel && intel.lcaSalary.comparisonLabel !== "Unknown" && (
            <SalaryIntelBadge comparisonLabel={intel.lcaSalary.comparisonLabel} />
          )}

          {/* Ghost job risk */}
          {intel.ghostJobRisk && (
            <GhostRiskBadge
              riskLevel={intel.ghostJobRisk.riskLevel}
              freshnessDays={intel.ghostJobRisk.freshnessDays}
            />
          )}

          {/* Application verdict */}
          {intel.applicationVerdict && (
            <ApplicationVerdictPill verdict={intel.applicationVerdict} />
          )}

          {/* Actions */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              aria-label={saved ? "Saved" : "Save job"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition",
                saved
                  ? "border-orange-200 bg-orange-50 text-orange-600"
                  : "border-slate-200 text-slate-700 hover:border-orange-200 hover:bg-orange-50"
              )}
            >
              <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
              {saved ? "Saved" : "Save"}
            </button>

            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-1.5 text-[13px] font-semibold text-white transition hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600/40"
            >
              Apply Now
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </a>
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
