"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Bookmark,
  Briefcase,
  Building2,
  Linkedin,
  MapPin,
  Repeat2,
  ShieldCheck,
  ShieldX,
  Wifi,
  Zap,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { MatchScoreBreakdownPopover } from "@/components/matching/MatchScoreBreakdownPopover"
import { useToast } from "@/components/ui/ToastProvider"
import {
  formatEmploymentLabel,
  formatSalaryLabel,
} from "@/lib/jobs/normalization/view-model"
import type { JobCardViewModel } from "@/lib/jobs/normalization/types"
import {
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
  hasUsableMatchScore,
  resolveOverallMatchScore,
} from "@/lib/jobs/match-score-display"
import {
  JOB_APPLICATION_SAVED_EVENT,
  JOB_APPLICATION_UNSAVED_EVENT,
  fetchJobSavedState,
  saveJobToPipeline,
  unsaveJobFromPipeline,
} from "@/lib/applications/save-job-client"
import { getApplyVariant, getApplyVariantLabel } from "@/lib/jobs/apply-cta"
import {
  readJobRepostCount,
  resolveGhostRepostSignals,
  type GhostRepostSignal,
} from "@/lib/jobs/ghost-repost-flags"
import { jobSourceFallbackLogo } from "@/lib/jobs/source-fallback-logo"
import { cn } from "@/lib/utils"
import type { JobMatchScore, JobWithCompany, JobWithMatchScore } from "@/types"

type RawRecord = Record<string, unknown>

function readRawRecord(job: JobWithCompany | JobWithMatchScore): RawRecord {
  if (job.raw_data && typeof job.raw_data === "object") return job.raw_data as RawRecord
  return {}
}

function formatWorkMode(job: JobWithCompany | JobWithMatchScore) {
  if (job.is_remote) return "Remote"
  if (job.is_hybrid) return "Hybrid"
  return "On-site"
}

function formatPostedLabel(timestamp: string, now: number) {
  const ts = Date.parse(timestamp)
  if (!Number.isFinite(ts)) return timestamp.replace(/^posted\s+/i, "").trim() || timestamp
  const ageMin = Math.max(1, Math.floor((now - ts) / 60_000))
  if (ageMin < 60) return `${ageMin}m`
  const ageHr = Math.floor(ageMin / 60)
  if (ageHr < 24) return `${ageHr}h`
  return `${Math.floor(ageHr / 24)}d`
}

function scoreColor(score: number | null): string {
  if (score == null) return "text-slate-400 ring-slate-200 bg-slate-50"
  if (score >= 85) return "text-emerald-700 ring-emerald-200 bg-emerald-50"
  if (score >= 70) return "text-blue-700 ring-blue-200 bg-blue-50"
  if (score >= 55) return "text-amber-700 ring-amber-200 bg-amber-50"
  return "text-slate-600 ring-slate-200 bg-slate-50"
}

function equalsIgnoreCase(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function ghostSignalPillClass(tone: GhostRepostSignal["tone"]): string {
  if (tone === "critical") return "bg-rose-50 text-rose-700 ring-rose-200"
  return "bg-amber-50 text-amber-700 ring-amber-200"
}

type JobListRowProps = {
  job: JobWithCompany | JobWithMatchScore
  enableHoverEffects?: boolean
  matchScore?: JobMatchScore | null
  isMatchScoreLoading?: boolean
  now?: number
  priorityLogo?: boolean
}

export default function JobListRow({
  job,
  enableHoverEffects = true,
  matchScore: matchScoreProp,
  isMatchScoreLoading = false,
  now: nowProp,
  priorityLogo = false,
}: JobListRowProps) {
  const { pushToast } = useToast()
  const router = useRouter()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const matchBadgeRef = useRef<HTMLButtonElement | null>(null)

  const now = nowProp ?? Date.now()
  const detailHref = `/dashboard/jobs/${job.id}`

  const raw = useMemo(() => readRawRecord(job), [job])
  const rawMatchScore = matchScoreProp ?? ("match_score" in job ? (job.match_score ?? null) : null)
  const resolvedMatchScore = hasUsableMatchScore(rawMatchScore) ? rawMatchScore : null
  const score = resolveOverallMatchScore({ preferredScore: resolvedMatchScore })
  const matchLabel = getMatchCardLabel(score)

  const cardView: JobCardViewModel = ("card_view" in job && job.card_view)
    ? (job.card_view as JobCardViewModel)
    : { title: job.title, location: job.location ?? null, salary_label: null, employment_label: null, seniority_label: null, preview_description: null, skills: [], skill_groups: { programmingLanguages:[], frameworks:[], cloud:[], databases:[], devops:[], aiMl:[], data:[], security:[], engineering:[], testing:[], networking:[], media:[], healthcare:[], science:[], softSkills:[] }, sponsorship_badge: null, visa_card_label: null, show_visa_drawer: false }
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
  const rawCompanyLogoUrl = job.company?.logo_url ?? null
  const sourceFallback = jobSourceFallbackLogo(job, rawCompanyDomain, rawCompanyLogoUrl)
  const companyDomain = sourceFallback?.domain ?? rawCompanyDomain
  const companyLogoUrl = sourceFallback?.logoUrl ?? rawCompanyLogoUrl
  const companyHref =
    job.company?.id && !showingEndClientName ? `/companies/${job.company.id}` : null

  const workMode = formatWorkMode(job)
  const employmentType = cardView.employment_label ?? formatEmploymentLabel(job.employment_type) ?? "Full-time"
  const salaryRange =
    cardView.salary_label ??
    formatSalaryLabel(job.salary_min, job.salary_max, job.salary_currency) ??
    null

  const postedSource = (raw["posted_at_normalized"] as string | undefined) ?? job.first_detected_at
  const postedAt = formatPostedLabel(postedSource, now)
  const postedTs = postedSource ? Date.parse(postedSource) : NaN
  const freshnessDays = Number.isFinite(postedTs) ? Math.floor((now - postedTs) / 86_400_000) : null
  const repostCount = readJobRepostCount(job)
  const ghostRepostSignals = useMemo(
    () => resolveGhostRepostSignals({ freshnessDays, repostCount }),
    [freshnessDays, repostCount]
  )
  const applyVariant = getApplyVariant(job.apply_url)
  const applyCtaLabel = getApplyVariantLabel(applyVariant)

  const visaCardLabel: SponsorshipVisaCardLabel = cardView.visa_card_label
  const sponsorshipDisplay = useMemo(
    () => resolveH1BSponsorshipDisplay(job, { visaCardLabel }),
    [job, visaCardLabel]
  )

  const workModePill =
    workMode === "Remote"
      ? "bg-emerald-500 text-white"
      : workMode === "Hybrid"
        ? "bg-sky-500 text-white"
        : "bg-slate-500 text-white"

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

  async function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (saving) return
    setSaving(true)
    try {
      if (saved) {
        const result = await unsaveJobFromPipeline(job.id)
        if (!result.ok) {
          if (result.status === 409) pushToast({ tone: "info", title: "Still in your pipeline", description: result.message })
          else if (result.status === 401) pushToast({ tone: "info", title: "Sign in to manage saved jobs", description: result.message })
          else pushToast({ tone: "error", title: "Couldn't remove", description: result.message })
          return
        }
        setSaved(false)
        window.dispatchEvent(new CustomEvent(JOB_APPLICATION_UNSAVED_EVENT, { detail: { jobId: job.id } }))
      } else {
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
      }
    } catch (err) {
      pushToast({ tone: "error", title: saved ? "Couldn't remove" : "Save failed", description: err instanceof Error ? err.message : "Try again." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => router.push(detailHref)}
      onMouseEnter={() => router.prefetch(detailHref)}
      onFocus={() => router.prefetch(detailHref)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(detailHref) }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:px-4",
        enableHoverEffects && "hover:border-slate-200 hover:shadow-[0_4px_14px_rgba(15,23,42,0.08)]"
      )}
    >
      <CompanyLogo
        companyName={companyName}
        domain={companyDomain}
        logoUrl={companyLogoUrl}
        priority={priorityLogo}
        className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-1"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[14px] font-semibold text-slate-950">{displayTitle}</h3>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-slate-500">
          {companyHref ? (
            <Link
              href={companyHref}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "truncate font-medium text-slate-600 transition",
                enableHoverEffects && "hover:text-slate-600 hover:underline"
              )}
            >
              {companyName}
            </Link>
          ) : (
            <span className="truncate font-medium text-slate-600">{companyName}</span>
          )}
          {showingEndClientName && (
            <>
              <span className="text-slate-300">·</span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                via staffing intermediary
              </span>
            </>
          )}
          {job.location?.trim() && (
            <>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3" aria-hidden />
                {job.location}
              </span>
            </>
          )}
        </div>
        {ghostRepostSignals.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {ghostRepostSignals.map((signal) => (
              <span
                key={`${signal.kind}:${signal.label}`}
                title={signal.detail}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1",
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
      </div>

      <div className="hidden items-center gap-1.5 md:flex">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", workModePill)}>
          {workMode === "Remote"
            ? <Wifi className="h-3 w-3" aria-hidden />
            : workMode === "Hybrid"
              ? <Building2 className="h-3 w-3" aria-hidden />
              : <MapPin className="h-3 w-3" aria-hidden />
          }
          {workMode}
        </span>
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
        {sponsorshipDisplay && (
          <span
            title={sponsorshipDisplay.label}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white",
              sponsorshipDisplay.tone === "emerald" ? "bg-emerald-500"
              : sponsorshipDisplay.tone === "sky" ? "bg-sky-500"
              : sponsorshipDisplay.tone === "amber" ? "bg-amber-500"
              : "bg-rose-500"
            )}
          >
            {sponsorshipDisplay.tone !== "rose"
              ? <ShieldCheck className="h-3 w-3" aria-hidden />
              : <ShieldX className="h-3 w-3" aria-hidden />
            }
            {sponsorshipDisplay.label}
          </span>
        )}
      </div>

      <span className="hidden text-[11px] font-medium text-slate-400 sm:inline">{postedAt}</span>

      <button
        ref={matchBadgeRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (resolvedMatchScore) setBreakdownOpen((v) => !v)
          else router.push(detailHref)
        }}
        disabled={score === null && !isMatchScoreLoading}
        aria-label={matchLabel}
        aria-haspopup="dialog"
        aria-expanded={breakdownOpen}
        title={resolvedMatchScore ? "See match breakdown" : matchLabel}
        className={cn(
          "flex h-10 w-12 shrink-0 flex-col items-center justify-center rounded-lg ring-1 tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-default",
          enableHoverEffects && "hover:opacity-85",
          scoreColor(score)
        )}
      >
        <span className="text-[14px] font-extrabold leading-none">
          {isMatchScoreLoading && score === null ? "…" : (score ?? "—")}
        </span>
        <span className="mt-0.5 text-[8px] font-bold uppercase tracking-widest opacity-70">match</span>
      </button>

      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          aria-label={saved ? "Saved" : "Save"}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition",
            saved
              ? "border-amber-200 bg-amber-50 text-amber-600"
              : cn(
                  "border-slate-200 bg-white text-slate-400",
                  enableHoverEffects && "hover:border-slate-200 hover:text-slate-500"
                )
          )}
        >
          <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
        </button>
        <a
          href={job.apply_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={applyCtaLabel}
          title={applyCtaLabel}
          className={cn(
            "hidden h-8 w-8 items-center justify-center rounded-lg border transition sm:inline-flex",
            applyVariant === "linkedin"
              ? cn(
                  "border-[#0a66c2]/30 bg-[#0a66c2]/10 text-[#0a66c2]",
                  enableHoverEffects && "hover:bg-[#0a66c2]/15"
                )
              : applyVariant === "autofill"
                ? cn(
                    "border-amber-200 bg-amber-50 text-amber-600",
                    enableHoverEffects && "hover:bg-amber-100"
                  )
                : cn(
                    "border-slate-200 bg-white text-slate-500",
                    enableHoverEffects && "hover:bg-slate-50 hover:text-slate-700"
                  )
          )}
        >
          {applyVariant === "linkedin" ? (
            <Linkedin className="h-3.5 w-3.5" />
          ) : applyVariant === "autofill" ? (
            <Zap className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5" />
          )}
        </a>
        <button
          type="button"
          onClick={() => router.push(detailHref)}
          aria-label="View details"
          className={cn(
            "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[12px] font-semibold text-slate-600 transition",
            enableHoverEffects && "hover:bg-slate-100"
          )}
        >
          View
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <MatchScoreBreakdownPopover
        score={resolvedMatchScore}
        open={breakdownOpen}
        anchorRef={matchBadgeRef}
        onClose={() => setBreakdownOpen(false)}
        onSeeFullAnalysis={() => {
          setBreakdownOpen(false)
          router.push(detailHref)
        }}
      />
    </article>
  )
}
