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
import { AutofillButton } from "@/components/autofill/AutofillButton"
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
      border: "border-l-[#FF5C18]",
      text: "text-[#FF5C18] font-semibold",
      dot: "bg-[#FF5C18]",
    }
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 6) {
    return {
      label: `${hours} hour${hours === 1 ? "" : "s"} ago`,
      tone: "teal" as FreshnessTone,
      showDot: true,
      border: "border-l-[#062246]",
      text: "text-[#062246] font-medium",
      dot: "bg-[#062246]",
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
      <span className="rounded-full border border-[#FFD2B8] bg-[#FFF7F2] px-2.5 py-1 text-[11px] font-semibold text-[#9A3412]">
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
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFD2B8] bg-[#FFF7F2] px-2.5 py-1 text-[11px] font-semibold text-[#062246]">
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
        className="inline-flex items-center gap-1.5 rounded-full border border-[#FFD2B8] bg-[#FFF7F2] px-2.5 py-1 text-[11px] font-semibold text-[#062246] transition hover:bg-[#FFF1E8]"
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
  const [saving, setSaving] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  async function handleBookmark() {
    if (saving) return
    setSaving(true)
    try {
      await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          companyName: job.company.name,
          companyLogoUrl: job.company.logo_url ?? undefined,
          jobTitle: job.title,
          applyUrl: job.apply_url,
          status: "saved",
          source: "hireoven",
        }),
      })
      setSaved(true)
    } catch {
      // silently ignore
    } finally {
      setSaving(false)
    }
  }
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
        className={`group rounded-[18px] border border-slate-200/80 border-l-4 ${freshness.border} bg-white p-5 text-left shadow-[0_10px_24px_rgba(15,23,42,0.045)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-[#FFFCFA] hover:shadow-[0_16px_30px_rgba(15,23,42,0.07)]`}
      >
        <div className="flex items-start gap-4">
          {job.company.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={job.company.logo_url}
              alt={job.company.name}
              className="h-12 w-12 rounded-[16px] border border-slate-200/80 object-cover shadow-[0_6px_16px_rgba(15,23,42,0.03)]"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[#FFF1E8] text-base font-semibold text-[#062246] shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
              {job.company.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              {job.company.name}
            </p>
            <h3 className="mt-2 text-[1.45rem] font-semibold leading-tight tracking-[-0.025em] text-slate-950">{job.title}</h3>

            <div className="mt-3.5 flex flex-wrap items-center gap-2.5 text-sm text-slate-500">
              {job.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {job.location}
                </span>
              )}
              {job.is_remote && (
                <span className="rounded-full border border-[#FFD2B8] bg-[#FFF7F2] px-2.5 py-1 text-[11px] font-semibold text-[#9A3412]">
                  Remote
                </span>
              )}
              {!job.is_remote && job.is_hybrid && (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                  Hybrid
                </span>
              )}
              {getSeniorityLabel(job.seniority_level) && (
                <span className="rounded-full border border-slate-200/80 bg-slate-100/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                  {getSeniorityLabel(job.seniority_level)}
                </span>
              )}
              {getEmploymentLabel(job.employment_type) && (
                <span className="rounded-full border border-slate-200/80 bg-slate-100/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                  {getEmploymentLabel(job.employment_type)}
                </span>
              )}
            </div>

            {visibleSkills.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {visibleSkills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-slate-200/80 bg-slate-100/70 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  >
                    {skill}
                  </span>
                ))}
                {hiddenSkillsCount > 0 && (
                  <span className="rounded-full border border-[#FFD9C2] bg-[#FFF8F4] px-2.5 py-1 text-[11px] font-semibold text-[#062246]">
                    +{hiddenSkillsCount} more
                  </span>
                )}
              </div>
            )}

            {expanded && description && (
              <div className="mt-4 rounded-[18px] border border-slate-200/70 bg-slate-50/75 p-4 text-sm leading-7 text-slate-600">
                {description}
              </div>
            )}

            {expanded && (
              <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                <Link
                  href={`/dashboard/cover-letter/${job.id}`}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200/80 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Write cover letter
                </Link>
              </div>
            )}
          </div>
        </div>

        <div
          className="mt-5 flex flex-col gap-3 border-t border-slate-200/75 pt-4 sm:flex-row sm:items-center sm:justify-between"
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
              onClick={() => void handleBookmark()}
              disabled={saved || saving}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-[14px] border transition ${
                saved
                  ? "border-[#FF5C18] bg-[#FFF1E8] text-[#FF5C18]"
                  : "border-slate-200/80 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800"
              } disabled:cursor-not-allowed`}
              aria-label={saved ? "Saved to pipeline" : "Save to pipeline"}
              title={saved ? "Saved to pipeline" : "Save to pipeline"}
            >
              <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
            </button>

            <button
              type="button"
              onClick={() => void shareJob()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] border border-slate-200/80 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
              aria-label="Share job"
            >
              <Share2 className="h-4 w-4" />
            </button>

            <AutofillButton jobId={job.id} className="rounded-[14px]" />

            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-[14px] bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
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
