"use client"

import { useEffect, useMemo, useState } from "react"
import { Briefcase, ExternalLink, Home, MapPin } from "lucide-react"
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
import { MatchBadge } from "@/components/jobs/card/MatchBadge"
import { VisaFitBadge } from "@/components/jobs/card/VisaFitBadge"
import { SalaryIntelBadge } from "@/components/jobs/card/SalaryIntelBadge"
import { GhostRiskBadge } from "@/components/jobs/card/GhostRiskBadge"
import { ApplicationVerdictPill } from "@/components/jobs/card/ApplicationVerdictPill"
import { SponsorshipBlockerBadge } from "@/components/jobs/card/SponsorshipBlockerBadge"
import { PostedTimeLabel } from "@/components/jobs/card/PostedTimeLabel"
import type { JobMatchScore, JobWithCompany, JobWithMatchScore } from "@/types"

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
  const score = resolvedMatchScore?.overall_score ?? null

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

  const workModeLabel = job.is_remote ? "Remote" : job.is_hybrid ? "Hybrid" : job.location?.trim() ? "On-site" : null

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

  const showScorePanel = showResumeSignal && (score !== null || isMatchScoreLoading)

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
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white transition-shadow hover:shadow-[0_2px_12px_rgba(15,23,42,0.07)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
      >
        {/* Header row */}
        <div className="flex min-w-0 flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <CompanyLogo
            companyName={companyName}
            domain={companyDomain}
            logoUrl={companyLogoUrl}
            priority={priorityLogo}
            className="h-12 w-12 flex-shrink-0 rounded-lg border border-slate-100"
          />

          <div className="min-w-0 flex-1">
            {/* Title + saved + top-match */}
            <div className="flex items-start justify-between gap-2 pr-1">
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 text-[16px] font-bold leading-snug text-slate-900 transition-colors group-hover:text-[#2563EB]">
                  {displayTitle}
                </h3>
              </div>
              {isBestMatch && (
                <span className="mt-0.5 flex-shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  Top match
                </span>
              )}
            </div>

            {/* Company + posted */}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {companyProfileHref ? (
                <Link
                  href={companyProfileHref}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[13px] font-semibold text-slate-700 transition hover:text-[#2563EB] hover:underline"
                >
                  {companyName}
                </Link>
              ) : (
                <span className="text-[13px] font-semibold text-slate-700">{companyName}</span>
              )}
              <span aria-hidden className="text-slate-300">·</span>
              <PostedTimeLabel firstDetectedAt={job.first_detected_at} now={now} />
            </div>

            {/* Location / employment / work mode / salary */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-slate-500">
              {job.location?.trim() && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                  {job.location}
                </span>
              )}
              {cardView.employment_label && (
                <span className="inline-flex items-center gap-1">
                  <Briefcase className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                  {cardView.employment_label}
                </span>
              )}
              {workModeLabel && (
                <span className="inline-flex items-center gap-1">
                  <Home className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                  {workModeLabel}
                </span>
              )}
              {cardView.salary_label && (
                <span className="font-semibold text-emerald-700">
                  {cardView.salary_label}
                </span>
              )}
            </div>

          </div>

          {showResumeSignal && (
            <button
              type="button"
              onClick={openMatchDetail}
              disabled={score === null && !isMatchScoreLoading}
              className="self-start rounded-2xl bg-white p-1.5 ring-1 ring-slate-100 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/25 sm:ml-2"
              aria-label="View match score"
            >
              <MatchBadge
                score={score}
                loading={isMatchScoreLoading && score === null}
                compact
                className="rounded-2xl px-2.5 py-1.5"
              />
            </button>
          )}
        </div>

        {/* Intelligence signal strip */}
        <div
          className="flex min-h-[36px] flex-wrap items-center gap-2 border-t border-[#F1F5F9] bg-[#FAFAFA] px-5 py-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Visa fit — only for international / enabled users */}
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

          {/* Sponsorship blocker — show always when detected */}
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

          {/* Spacer + actions */}
          <div className="ml-auto flex items-center gap-3">
            {/* Save */}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              aria-label={saved ? "Saved" : "Save job"}
              className={cn(
                "text-[12px] font-semibold transition",
                saved
                  ? "text-amber-600 hover:text-amber-700"
                  : "text-slate-500 hover:text-slate-900"
              )}
            >
              {saved ? "Saved ✓" : "Save"}
            </button>

            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-md bg-[#2563EB] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
            >
              Apply
              <ExternalLink className="h-3 w-3" strokeWidth={2.5} aria-hidden />
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
