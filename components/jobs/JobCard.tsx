"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  BadgeCheck,
  Bookmark,
  Briefcase,
  Clock,
  DollarSign,
  ExternalLink,
  Home,
  MapPin,
  Plane,
} from "lucide-react"

import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useH1BPrediction } from "@/lib/context/H1BPredictionContext"
import { resolveJobCardView } from "@/lib/jobs/normalization"
import {
  effectiveEmployerSponsorshipScore,
  employerLikelySponsorsH1b,
  employerSponsorshipCardCopy,
} from "@/lib/jobs/sponsorship-employer-signal"
import {
  JOB_APPLICATION_SAVED_EVENT,
  fetchJobSavedState,
  saveJobToPipeline,
} from "@/lib/applications/save-job-client"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"
import type { JobMatchScore, JobWithCompany, JobWithMatchScore } from "@/types"

const QuickAnalysisDrawer = dynamic(
  () => import("@/components/resume/QuickAnalysisDrawer"),
  { ssr: false }
)

const H1BPredictionDrawer = dynamic(
  () => import("@/components/h1b/H1BPredictionDrawer"),
  { ssr: false }
)

type JobCardProps = {
  job: JobWithCompany | JobWithMatchScore
  hasPrimaryResume?: boolean
  analysisIndex?: number
  isBestMatch?: boolean
  matchScore?: JobMatchScore | null
  isMatchScoreLoading?: boolean
  now?: number
  /** Hint that this card is above the fold; eager-loads its company logo. */
  priorityLogo?: boolean
}

function formatFreshness(timestamp: string, now: number) {
  const minutes = Math.max(1, Math.floor((now - new Date(timestamp).getTime()) / 60_000))
  if (minutes < 60) return { label: `${minutes} min ago`, textClass: "text-slate-600" }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return { label: `${hours} hour${hours === 1 ? "" : "s"} ago`, textClass: "text-slate-600" }
  }
  const days = Math.floor(hours / 24)
  return { label: `${days} day${days === 1 ? "" : "s"} ago`, textClass: "text-slate-500" }
}

function MatchGauge({ score, loading }: { score: number | null; loading?: boolean }) {
  const r = 28
  const c = Math.PI * r
  const pct = loading || score === null ? 0 : Math.min(100, Math.max(0, score)) / 100
  return (
    <div className="relative mx-auto h-[50px] w-[76px]">
      <svg width="76" height="50" viewBox="0 0 76 50" className="mx-auto block" aria-hidden>
        <path
          d="M 10 42 A 28 28 0 0 1 66 42"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {!loading && score !== null && (
          <path
            d="M 10 42 A 28 28 0 0 1 66 42"
            fill="none"
            stroke="#22c55e"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${pct * c} ${c}`}
          />
        )}
      </svg>
      {!loading && score !== null && (
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[1.35rem] font-bold leading-none text-slate-900">
          {score}
          <span className="text-xs font-semibold text-slate-500">%</span>
        </span>
      )}
    </div>
  )
}

export default function JobCard({
  job,
  hasPrimaryResume,
  analysisIndex = -1,
  isBestMatch = false,
  matchScore: matchScoreProp,
  isMatchScoreLoading = false,
  now: nowProp,
  priorityLogo = false,
}: JobCardProps) {
  const { pushToast } = useToast()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [h1bDrawerOpen, setH1bDrawerOpen] = useState(false)

  const {
    attachRef: h1bAttachRef,
    prediction: h1bPrediction,
    isLoading: h1bIsLoading,
  } = useH1BPrediction(job.id)
  const now = nowProp ?? Date.now()
  const freshness = formatFreshness(job.first_detected_at, now)
  const router = useRouter()
  const { primaryResume } = useResumeContext()
  const showResumeSignal = typeof hasPrimaryResume === "boolean" ? hasPrimaryResume : Boolean(primaryResume)

  const resolvedMatchScore = matchScoreProp ?? ("match_score" in job ? (job.match_score ?? null) : null)
  const score = resolvedMatchScore?.overall_score ?? null

  const companyName = job.company?.name ?? "Unknown company"
  const companyDomain = job.company?.domain ?? null
  const companyLogoUrl = job.company?.logo_url ?? null
  const companyConf = job.company?.sponsorship_confidence ?? 0

  const cardView = resolveJobCardView(job)
  const displayTitle = cardView.title

  const showVerified =
    employerLikelySponsorsH1b(job) || companyConf >= 35 || Boolean(job.company?.sponsors_h1b)

  const sponsorScore = effectiveEmployerSponsorshipScore(job)
  const showSponsorshipBanner =
    employerLikelySponsorsH1b(job) || (!job.requires_authorization && sponsorScore >= 55)
  const sponsorshipCopy = showSponsorshipBanner ? employerSponsorshipCardCopy(job) : null

  const workModeLabel = job.is_remote ? "Remote" : job.is_hybrid ? "Hybrid" : job.location?.trim() ? "On-site" : null

  const displaySkills = useMemo(() => {
    if (job.skills && job.skills.length > 0) return job.skills
    if (cardView.skills.length > 0) return cardView.skills
    return []
  }, [job.skills, cardView.skills])

  const metaItems = useMemo(() => {
    const items: { key: string; node: ReactNode }[] = []
    if (job.location?.trim()) {
      items.push({
        key: "loc",
        node: (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="line-clamp-1">{job.location}</span>
          </span>
        ),
      })
    }
    if (cardView.employment_label) {
      items.push({
        key: "emp",
        node: (
          <span className="inline-flex items-center gap-1">
            <Briefcase className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {cardView.employment_label}
          </span>
        ),
      })
    }
    if (workModeLabel) {
      items.push({
        key: "mode",
        node: (
          <span className="inline-flex items-center gap-1">
            <Home className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {workModeLabel}
          </span>
        ),
      })
    }
    if (cardView.salary_label) {
      items.push({
        key: "salary",
        node: (
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
            <DollarSign className="h-3.5 w-3.5 shrink-0" />
            {cardView.salary_label}
          </span>
        ),
      })
    }
    return items
  }, [job.location, cardView.employment_label, workModeLabel, cardView.salary_label])

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

  async function handleBookmark(e: React.MouseEvent) {
    e.stopPropagation()
    if (saving || saved) return
    setSaving(true)
    try {
      const result = await saveJobToPipeline({
        jobId: job.id,
        companyName,
        companyLogoUrl: companyLogoUrl,
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
    } catch (e) {
      pushToast({
        tone: "error",
        title: "Save failed",
        description: e instanceof Error ? e.message : "Try again.",
      })
    } finally {
      setSaving(false)
    }
  }

  const showScorePanel = showResumeSignal && (score !== null || isMatchScoreLoading)

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
        onClick={() => router.push(`/dashboard/jobs/${job.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            router.push(`/dashboard/jobs/${job.id}`)
          }
        }}
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-none transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
      >
        <button
          type="button"
          onClick={(e) => void handleBookmark(e)}
          disabled={saved || saving}
          className={cn(
            "absolute right-3 top-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed",
            saved && "text-amber-600 hover:text-amber-700"
          )}
          aria-label={saved ? "Saved" : "Save job"}
        >
          <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
        </button>

        <div className="flex w-full min-w-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-w-0 flex-1 items-start gap-5 p-5 sm:pr-10 lg:pr-10">
            <CompanyLogo
              companyName={companyName}
              domain={companyDomain}
              logoUrl={companyLogoUrl}
              priority={priorityLogo}
              className="h-[72px] w-[72px] flex-shrink-0 rounded-xl border-0 bg-transparent"
            />

            <div className="min-w-0 flex-1">
              <h3 className="text-[17px] font-bold leading-tight text-slate-900 transition-colors group-hover:text-[#2563EB] pr-8">
                {displayTitle}
              </h3>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-[14px] font-medium text-slate-700">{companyName}</span>
                {showVerified && (
                  <BadgeCheck
                    className="h-4 w-4 shrink-0 text-[#2563EB]"
                    aria-label="Verified employer signal"
                  />
                )}
                <span aria-hidden className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-700">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                  Posted {freshness.label}
                </span>
                {isBestMatch && (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    Top match
                  </span>
                )}
              </div>

              {metaItems.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-slate-500">
                  {metaItems.map((item) => (
                    <span key={item.key} className="inline-flex items-center">
                      {item.node}
                    </span>
                  ))}
                </div>
              )}

              {displaySkills.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {displaySkills.slice(0, 8).map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-sky-50 px-2.5 py-1 text-[12px] font-medium text-sky-800"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}

            </div>
          </div>

          <div
            className="flex w-full shrink-0 flex-col gap-2 border-t border-[#E5E7EB] px-5 py-4 sm:w-[220px] sm:justify-center sm:border-l sm:border-t-0 sm:px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="group/apply inline-flex items-center gap-1 self-end text-[12px] font-semibold text-[#2563EB] transition hover:text-[#1D4ED8] focus-visible:outline-none focus-visible:underline"
            >
              Apply Now
              <ExternalLink
                className="h-3 w-3 transition group-hover/apply:translate-x-0.5"
                strokeWidth={2.25}
              />
            </a>

            {showSponsorshipBanner && sponsorshipCopy && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setH1bDrawerOpen(true)
                }}
                aria-label="Open H-1B and LCA prediction"
                className="group block w-full rounded-lg bg-emerald-50/80 p-3 text-left transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <div className="flex items-start gap-2">
                  <Plane className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-700" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-emerald-900">{sponsorshipCopy.title}</p>
                    {sponsorshipCopy.scorePercent != null && (
                      <p className="mt-1 text-[11px] font-semibold text-emerald-900">
                        {sponsorshipCopy.scorePercent}% employer signal
                      </p>
                    )}
                    <p className="mt-1 text-[11px] leading-snug text-emerald-800/90">
                      {sponsorshipCopy.sourceLabel}
                    </p>
                  </div>
                </div>
              </button>
            )}
          </div>

          {showScorePanel && (
            <div
              className="flex w-full min-w-0 flex-shrink-0 flex-col items-center justify-center gap-1 border-t border-[#E5E7EB] px-4 py-4 sm:w-[132px] sm:border-l sm:border-t-0"
              onClick={(e) => e.stopPropagation()}
            >
              {isMatchScoreLoading && score === null ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <div className="h-10 w-16 animate-pulse rounded-lg bg-slate-200/80" />
                  <div className="h-2 w-14 animate-pulse rounded-full bg-slate-200/80" />
                </div>
              ) : score !== null ? (
                <button
                  type="button"
                  onClick={openMatchDetail}
                  className="flex w-full flex-col items-center focus-visible:outline-none"
                >
                  <MatchGauge score={score} />
                  <p className="mt-0.5 text-[11px] font-medium text-slate-600">Match Score</p>
                  <span className="mt-1.5 text-[12px] font-semibold text-[#2563EB] hover:underline">
                    View match
                  </span>
                </button>
              ) : null}
            </div>
          )}
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
