"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Bookmark,
  ExternalLink,
  FileText,
  MapPin,
  Share2,
  Sparkles,
} from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useResumeAnalysis } from "@/lib/hooks/useResumeAnalysis"
import { cn } from "@/lib/utils"
import type { JobWithCompany } from "@/types"

const QuickAnalysisDrawer = dynamic(
  () => import("@/components/resume/QuickAnalysisDrawer"),
  { ssr: false }
)

type JobCardProps = {
  job: JobWithCompany
  hasPrimaryResume?: boolean
  /** Cards with index < 10 auto-trigger analysis; rest show "See match" button */
  analysisIndex?: number
}

type FreshnessTone = "green" | "teal" | "gray" | "muted"

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

function useLiveNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])
  return now
}

function formatFreshness(timestamp: string, now: number) {
  const postedAt = new Date(timestamp).getTime()
  const minutes = Math.max(1, Math.floor((now - postedAt) / 60_000))

  if (minutes < 60) {
    return {
      label: `${minutes} min ago`,
      tone: "green" as FreshnessTone,
      showDot: true,
      border: "border-l-[#0369A1]",
      text: "text-[#0369A1] font-semibold",
      dot: "bg-[#0369A1]",
    }
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 6) {
    return {
      label: `${hours} hour${hours === 1 ? "" : "s"} ago`,
      tone: "teal" as FreshnessTone,
      showDot: true,
      border: "border-l-[#0C4A6E]",
      text: "text-[#0C4A6E] font-medium",
      dot: "bg-[#0C4A6E]",
    }
  }

  if (hours < 24) {
    return {
      label: `${hours} hour${hours === 1 ? "" : "s"} ago`,
      tone: "gray" as FreshnessTone,
      showDot: true,
      border: "border-l-transparent",
      text: "text-gray-500",
      dot: "bg-gray-400",
    }
  }

  const days = Math.floor(hours / 24)
  return {
    label: `${days} day${days === 1 ? "" : "s"} ago`,
    tone: "muted" as FreshnessTone,
    showDot: false,
    border: "border-l-transparent",
    text: "text-gray-400",
    dot: "",
  }
}

function getEmploymentLabel(value: JobWithCompany["employment_type"]) {
  if (!value) return null
  const map = { fulltime: "Full-time", parttime: "Part-time", contract: "Contract", internship: "Internship" }
  return map[value]
}

function getSeniorityLabel(value: JobWithCompany["seniority_level"]) {
  if (!value) return null
  if (value === "staff") return "Staff+"
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function SponsorshipBadge({ job }: { job: JobWithCompany }) {
  if (job.sponsors_h1b) {
    return (
      <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
        Sponsors H1B
      </span>
    )
  }
  if (job.requires_authorization) {
    return (
      <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
        No sponsorship
      </span>
    )
  }
  if ((job.sponsorship_score ?? 0) > 60) {
    return (
      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
        Likely sponsors
      </span>
    )
  }
  return null
}

function scoreStyle(score: number) {
  if (score >= 70) return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (score >= 40) return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-red-200 bg-red-50 text-red-700"
}

function ScorePill({
  resumeId,
  jobId,
  analysisIndex,
  onOpen,
}: {
  resumeId: string
  jobId: string
  analysisIndex: number
  onOpen: () => void
}) {
  const autoAnalyze = analysisIndex < 10
  const { analysis, isLoading, isAnalyzing, triggerAnalysis } = useResumeAnalysis(resumeId, jobId)

  // Auto-trigger for first 10
  useEffect(() => {
    if (!autoAnalyze) return
    if (!isLoading && !analysis && !isAnalyzing) {
      void triggerAnalysis()
    }
  }, [autoAnalyze, isLoading, analysis, isAnalyzing, triggerAnalysis])

  if (isLoading || isAnalyzing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#BAE6FD] bg-[#F0F9FF] px-2.5 py-1 text-[11px] font-semibold text-[#0C4A6E]">
        <Sparkles className="h-3.5 w-3.5 animate-pulse" />
        Analyzing…
      </span>
    )
  }

  if (analysis?.overall_score != null) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:opacity-80",
          scoreStyle(analysis.overall_score)
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {analysis.overall_score}% match
      </button>
    )
  }

  // For cards > index 9 with no cached analysis: show on-demand button
  if (!autoAnalyze) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#BAE6FD] bg-[#F0F9FF] px-2.5 py-1 text-[11px] font-semibold text-[#0C4A6E] transition hover:bg-[#E0F2FE]"
      >
        <Sparkles className="h-3.5 w-3.5" />
        See match
      </button>
    )
  }

  return null
}

export default function JobCard({ job, hasPrimaryResume, analysisIndex = 99 }: JobCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const now = useLiveNow()
  const freshness = formatFreshness(job.first_detected_at, now)
  const { primaryResume } = useResumeContext()
  const showResumeSignal =
    typeof hasPrimaryResume === "boolean" ? hasPrimaryResume : Boolean(primaryResume)

  const description = useMemo(
    () => (job.description ? stripHtml(job.description) : ""),
    [job.description]
  )

  const visibleSkills = job.skills?.slice(0, 4) ?? []
  const hiddenSkillsCount = Math.max(0, (job.skills?.length ?? 0) - visibleSkills.length)

  async function shareJob() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${job.title} at ${job.company.name}`, url: job.apply_url })
        return
      }
    } catch { return }
    await navigator.clipboard.writeText(job.apply_url)
  }

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((c) => !c)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setExpanded((c) => !c)
          }
        }}
        className={`group rounded-3xl border border-gray-200 border-l-4 ${freshness.border} bg-white p-5 text-left shadow-[0_1px_0_rgba(15,23,42,0.02)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#FBFEFD] hover:shadow-[0_18px_40px_rgba(14,37,32,0.08)]`}
      >
        <div className="flex items-start gap-4">
          {job.company.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={job.company.logo_url}
              alt={job.company.name}
              className="h-10 w-10 rounded-2xl border border-gray-200 object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#E0F2FE] text-sm font-semibold text-[#0C4A6E]">
              {job.company.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">
              {job.company.name}
            </p>
            <h3 className="mt-1 text-lg font-semibold leading-tight text-gray-900">{job.title}</h3>

            <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-gray-500">
              {job.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {job.location}
                </span>
              )}
              {job.is_remote && (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                  Remote
                </span>
              )}
              {!job.is_remote && job.is_hybrid && (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                  Hybrid
                </span>
              )}
              {getSeniorityLabel(job.seniority_level) && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
                  {getSeniorityLabel(job.seniority_level)}
                </span>
              )}
              {getEmploymentLabel(job.employment_type) && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
                  {getEmploymentLabel(job.employment_type)}
                </span>
              )}
            </div>

            {visibleSkills.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {visibleSkills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600"
                  >
                    {skill}
                  </span>
                ))}
                {hiddenSkillsCount > 0 && (
                  <span className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-xs font-medium text-[#0C4A6E]">
                    +{hiddenSkillsCount} more
                  </span>
                )}
              </div>
            )}

            {expanded && description && (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-4 text-sm leading-7 text-gray-600">
                {description}
              </div>
            )}

            {expanded && (
              <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                <Link
                  href={`/dashboard/cover-letter/${job.id}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Write cover letter
                </Link>
              </div>
            )}
          </div>
        </div>

        <div
          className="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              {freshness.showDot && <span className={`h-2 w-2 rounded-full ${freshness.dot}`} />}
              <span className={`text-sm ${freshness.text}`}>{freshness.label}</span>
            </div>

            {showResumeSignal && primaryResume?.parse_status === "complete" && primaryResume.id && (
              <ScorePill
                resumeId={primaryResume.id}
                jobId={job.id}
                analysisIndex={analysisIndex}
                onOpen={() => setDrawerOpen(true)}
              />
            )}

            <SponsorshipBadge job={job} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSaved((c) => !c)}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition ${
                saved
                  ? "border-[#0369A1] bg-[#E0F2FE] text-[#0369A1]"
                  : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-800"
              }`}
              aria-label={saved ? "Remove bookmark" : "Save job"}
            >
              <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
            </button>

            <button
              type="button"
              onClick={() => void shareJob()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-500 transition hover:border-gray-300 hover:text-gray-800"
              aria-label="Share job"
            >
              <Share2 className="h-4 w-4" />
            </button>

            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985]"
            >
              Apply directly
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </article>

      {drawerOpen && primaryResume?.id && (
        <QuickAnalysisDrawer
          resumeId={primaryResume.id}
          jobId={job.id}
          jobTitle={`${job.title} at ${job.company.name}`}
          applyUrl={job.apply_url}
          onClose={() => setDrawerOpen(false)}
          autoAnalyze
        />
      )}
    </>
  )
}
