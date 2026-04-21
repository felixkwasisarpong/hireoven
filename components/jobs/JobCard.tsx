"use client"

import { useMemo, useState } from "react"
import {
  Bookmark,
  ExternalLink,
  FileText,
  MapPin,
  Share2,
} from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AutofillButton } from "@/components/autofill/AutofillButton"
import H1BPredictionBadge from "@/components/h1b/H1BPredictionBadge"
import { MatchScorePill } from "@/components/matching/MatchScorePill"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useH1BPrediction } from "@/lib/context/H1BPredictionContext"
import { getSeniorityGap } from "@/lib/matching/fast-scorer"
import { cn } from "@/lib/utils"
import type { JobMatchScore, JobWithCompany, JobWithMatchScore } from "@/types"

const H1BPredictionDrawer = dynamic(
  () => import("@/components/h1b/H1BPredictionDrawer"),
  { ssr: false }
)

const QuickAnalysisDrawer = dynamic(
  () => import("@/components/resume/QuickAnalysisDrawer"),
  { ssr: false }
)

type JobCardProps = {
  job: JobWithCompany | JobWithMatchScore
  hasPrimaryResume?: boolean
  analysisIndex?: number
  matchScore?: JobMatchScore | null
  isMatchScoreLoading?: boolean
  /** Shared clock for freshness labels (avoid one interval per row). */
  now?: number
}

type FreshnessTone = "green" | "teal" | "gray" | "muted"

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

function formatSalaryRange(job: JobWithCompany | JobWithMatchScore) {
  if (job.salary_min == null || job.salary_max == null) return null
  const sym =
    job.salary_currency === "USD" || !job.salary_currency ? "$" : `${job.salary_currency} `
  const a = Math.round(job.salary_min / 1000)
  const b = Math.round(job.salary_max / 1000)
  return `${sym}${a}k–${sym}${b}k`
}

function formatFreshness(timestamp: string, now: number) {
  const postedAt = new Date(timestamp).getTime()
  const minutes = Math.max(1, Math.floor((now - postedAt) / 60_000))

  if (minutes < 60) {
    return {
      label: `${minutes} min ago`,
      tone: "green" as FreshnessTone,
      showDot: true,
      accentClass: "bg-primary",
      text: "text-primary font-semibold",
      dot: "bg-primary",
    }
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 6) {
    return {
      label: `${hours} hour${hours === 1 ? "" : "s"} ago`,
      tone: "teal" as FreshnessTone,
      showDot: true,
      accentClass: "bg-brand-navy",
      text: "text-brand-navy font-medium",
      dot: "bg-brand-navy",
    }
  }

  if (hours < 24) {
    return {
      label: `${hours} hour${hours === 1 ? "" : "s"} ago`,
      tone: "gray" as FreshnessTone,
      showDot: true,
      accentClass: "bg-transparent",
      text: "text-muted-foreground",
      dot: "bg-muted-foreground/50",
    }
  }

  const days = Math.floor(hours / 24)
  return {
    label: `${days} day${days === 1 ? "" : "s"} ago`,
    tone: "muted" as FreshnessTone,
    showDot: false,
    accentClass: "bg-transparent",
    text: "text-muted-foreground/80",
    dot: "",
  }
}

function getEmploymentLabel(value: JobWithCompany["employment_type"]) {
  if (!value) return null
  const map = {
    fulltime: "Full-time",
    parttime: "Part-time",
    contract: "Contract",
    internship: "Internship",
  }
  return map[value]
}

function getSeniorityLabel(value: JobWithCompany["seniority_level"]) {
  if (!value) return null
  if (value === "staff") return "Staff+"
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function SponsorshipBadge({ job }: { job: JobWithCompany | JobWithMatchScore }) {
  if (job.sponsors_h1b) {
    return (
      <span className="inline-flex items-center rounded border border-border bg-surface-alt px-2 py-0.5 text-[11px] font-semibold text-brand-navy">
        Sponsors H1B
      </span>
    )
  }

  if (job.requires_authorization) {
    return (
      <span className="inline-flex items-center rounded border border-danger/25 bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
        No sponsorship
      </span>
    )
  }

  if ((job.sponsorship_score ?? 0) > 60) {
    return (
      <span className="inline-flex items-center rounded border border-warning/30 bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
        Likely sponsors
      </span>
    )
  }

  return null
}

export default function JobCard({
  job,
  hasPrimaryResume,
  analysisIndex = 99,
  matchScore: matchScoreProp,
  isMatchScoreLoading = false,
  now: nowProp,
}: JobCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [h1bDrawerOpen, setH1BDrawerOpen] = useState(false)
  const {
    enabled: h1bEnabled,
    attachRef: h1bAttachRef,
    prediction: h1bPrediction,
    isLoading: h1bIsLoading,
  } = useH1BPrediction(job.id)
  const now = nowProp ?? Date.now()
  const freshness = formatFreshness(job.first_detected_at, now)
  const router = useRouter()
  const { primaryResume } = useResumeContext()
  const showResumeSignal =
    typeof hasPrimaryResume === "boolean" ? hasPrimaryResume : Boolean(primaryResume)

  const resolvedMatchScore =
    matchScoreProp ?? ("match_score" in job ? (job.match_score ?? null) : null)

  const description = useMemo(
    () => (job.description ? stripHtml(job.description) : ""),
    [job.description]
  )
  const visibleSkills = job.skills?.slice(0, 4) ?? []
  const hiddenSkillsCount = Math.max(0, (job.skills?.length ?? 0) - visibleSkills.length)
  const seniorityGap = getSeniorityGap(
    primaryResume?.seniority_level,
    job.seniority_level
  )
  const hasSeniorityMismatch = seniorityGap !== null && Math.abs(seniorityGap) > 2
  const salaryLabel = formatSalaryRange(job)

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
          matchScore: resolvedMatchScore?.overall_score ?? null,
        }),
      })
      setSaved(true)
    } catch {
      // Ignore save failures for now to preserve current interaction style.
    } finally {
      setSaving(false)
    }
  }

  async function shareJob() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${job.title} at ${job.company.name}`,
          url: job.apply_url,
        })
        return
      }
    } catch {
      return
    }

    await navigator.clipboard.writeText(job.apply_url)
  }

  const scoreLoading = isMatchScoreLoading

  return (
    <>
      <article
        ref={h1bAttachRef as (node: HTMLElement | null) => void}
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setExpanded((current) => !current)
          }
        }}
        className={cn(
          "group relative border-b border-border bg-surface text-left transition-colors last:border-b-0",
          "hover:bg-surface-alt/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-inset",
          freshness.tone === "green" && "border-l-[3px] border-l-primary"
        )}
      >
        <div className="flex gap-3 p-4 sm:gap-4 sm:p-5">
          <CompanyLogo
            companyName={job.company.name}
            domain={job.company.domain}
            logoUrl={job.company.logo_url}
            className="h-11 w-11 sm:h-12 sm:w-12"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 lg:flex-row lg:gap-6">
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {job.company.name}
                  </p>
                  <h3 className="mt-1 text-[1.125rem] font-semibold leading-snug tracking-[-0.02em] text-strong sm:text-[1.2rem]">
                    {job.title}
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted-foreground">
                  {job.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
                      {job.location}
                    </span>
                  )}
                  {job.is_remote && (
                    <span className="rounded border border-border bg-surface-alt px-2 py-0.5 text-[11px] font-semibold text-brand-navy">
                      Remote
                    </span>
                  )}
                  {!job.is_remote && job.is_hybrid && (
                    <span className="rounded border border-border bg-surface-alt px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">
                      Hybrid
                    </span>
                  )}
                  {getSeniorityLabel(job.seniority_level) && (
                    <span className="rounded border border-border bg-surface-muted/80 px-2 py-0.5 text-[11px] font-medium text-strong">
                      {getSeniorityLabel(job.seniority_level)}
                    </span>
                  )}
                  {getEmploymentLabel(job.employment_type) && (
                    <span className="rounded border border-border bg-surface-muted/80 px-2 py-0.5 text-[11px] font-medium text-strong">
                      {getEmploymentLabel(job.employment_type)}
                    </span>
                  )}
                  {salaryLabel && (
                    <span className="font-medium tabular-nums text-strong">{salaryLabel}</span>
                  )}
                </div>

                {visibleSkills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {visibleSkills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded border border-border bg-surface-alt px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {skill}
                      </span>
                    ))}
                    {hiddenSkillsCount > 0 && (
                      <span className="rounded border border-border bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand-navy">
                        +{hiddenSkillsCount} more
                      </span>
                    )}
                  </div>
                )}

                {expanded && description && (
                  <div className="mt-3 border border-border bg-surface-alt/60 p-3 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </div>
                )}

                {expanded && (
                  <div
                    className="mt-2 flex flex-wrap gap-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Link
                      href={`/dashboard/cover-letter/${job.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-surface-alt hover:text-strong"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Write cover letter
                    </Link>
                  </div>
                )}
              </div>

              <div className="flex flex-shrink-0 flex-col gap-2 border-t border-border pt-3 sm:border-t-0 sm:pt-0 lg:w-[200px] lg:border-t-0 lg:items-end lg:text-right">
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  {freshness.showDot && (
                    <span className={`h-1.5 w-1.5 rounded-full ${freshness.dot}`} />
                  )}
                  <span className={`text-[13px] ${freshness.text}`}>{freshness.label}</span>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {showResumeSignal && primaryResume?.parse_status === "complete" ? (
                    <MatchScorePill
                      score={resolvedMatchScore?.overall_score ?? null}
                      method={resolvedMatchScore?.score_method ?? null}
                      isLoading={scoreLoading}
                      size="sm"
                      showDisqualifiers
                      isSponsorshipCompatible={resolvedMatchScore?.is_sponsorship_compatible}
                      hasSeniorityMismatch={hasSeniorityMismatch}
                      onClick={() => {
                        if (resolvedMatchScore?.score_method === "deep") {
                          router.push(`/dashboard/resume/analyze/${job.id}`)
                          return
                        }
                        setDrawerOpen(true)
                      }}
                    />
                  ) : (
                    <MatchScorePill
                      score={null}
                      method={null}
                      isLoading={false}
                      size="sm"
                      onClick={() => router.push("/dashboard/resume")}
                    />
                  )}
                  <SponsorshipBadge job={job} />
                  {h1bEnabled && (
                    <H1BPredictionBadge
                      prediction={h1bPrediction}
                      isLoading={h1bIsLoading && !h1bPrediction}
                      size="sm"
                      companyName={job.company.name}
                      onClick={() => setH1BDrawerOpen(true)}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="flex flex-col gap-3 border-t border-border bg-surface-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="hidden text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:block">
            {expanded ? "Click row to collapse" : "Click row for description"}
          </p>

          <div className="flex flex-wrap items-center justify-end gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => void handleBookmark()}
              disabled={saved || saving}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed",
                saved
                  ? "border-primary/40 bg-brand-tint text-primary"
                  : "border-border bg-surface text-muted-foreground hover:border-border hover:bg-surface-alt hover:text-strong"
              )}
              aria-label={saved ? "Saved to pipeline" : "Save to pipeline"}
              title={saved ? "Saved to pipeline" : "Save to pipeline"}
            >
              <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
            </button>

            <button
              type="button"
              onClick={() => void shareJob()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:border-border hover:bg-surface-alt hover:text-strong"
              aria-label="Share job"
            >
              <Share2 className="h-4 w-4" />
            </button>

            <AutofillButton jobId={job.id} className="rounded-md" />

            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
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
          autoAnalyze={analysisIndex < 10}
        />
      )}

      {h1bDrawerOpen && (
        <H1BPredictionDrawer
          jobId={job.id}
          jobTitle={job.title}
          companyName={job.company.name}
          prediction={h1bPrediction}
          isLoading={h1bIsLoading && !h1bPrediction}
          onClose={() => setH1BDrawerOpen(false)}
        />
      )}
    </>
  )
}
