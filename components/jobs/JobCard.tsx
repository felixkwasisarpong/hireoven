"use client"

import { type ReactNode, useMemo, useState } from "react"
import {
  BadgeCheck,
  Bookmark,
  Briefcase,
  Clock3,
  ExternalLink,
  FileText,
  FlaskConical,
  MapPin,
  Share2,
  WalletCards,
  Zap,
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
import { resolveJobCardView } from "@/lib/jobs/normalization"
import { extractExperienceLabel } from "@/lib/jobs/metadata"
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
  now?: number
}

type FreshnessTone = "green" | "teal" | "gray" | "muted"

const ACCENT_GRADIENTS = [
  "from-[#FF5C18] to-[#FF8A57]",
  "from-[#246BFD] to-[#5A95FF]",
  "from-[#7B3FF3] to-[#A06BFF]",
  "from-[#0EA5A0] to-[#30C5BF]",
]

function hashAccent(key: string) {
  let value = 0
  for (let i = 0; i < key.length; i += 1) {
    value = (value * 31 + key.charCodeAt(i)) >>> 0
  }
  return value % ACCENT_GRADIENTS.length
}

function formatFreshness(timestamp: string, now: number) {
  const postedAt = new Date(timestamp).getTime()
  const minutes = Math.max(1, Math.floor((now - postedAt) / 60_000))

  if (minutes < 60) {
    return {
      label: `${minutes} min ago`,
      tone: "green" as FreshnessTone,
      text: "text-[#FF5C18] font-semibold",
      dot: "bg-[#FF5C18]",
    }
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 6) {
    return {
      label: `${hours} hour${hours === 1 ? "" : "s"} ago`,
      tone: "teal" as FreshnessTone,
      text: "text-[#334A82] font-medium",
      dot: "bg-[#334A82]",
    }
  }

  if (hours < 24) {
    return {
      label: `${hours} hour${hours === 1 ? "" : "s"} ago`,
      tone: "gray" as FreshnessTone,
      text: "text-muted-foreground",
      dot: "bg-muted-foreground/60",
    }
  }

  const days = Math.floor(hours / 24)
  return {
    label: `${days} day${days === 1 ? "" : "s"} ago`,
    tone: "muted" as FreshnessTone,
    text: "text-muted-foreground/80",
    dot: "bg-muted-foreground/40",
  }
}

function SponsorshipBadge({ badgeKind }: { badgeKind: "sponsors" | "no_sponsorship" | "likely" | null }) {
  if (badgeKind === "sponsors") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
        Sponsors H1B
      </span>
    )
  }

  if (badgeKind === "no_sponsorship") {
    return (
      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
        No sponsorship
      </span>
    )
  }

  if (badgeKind === "likely") {
    return (
      <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700">
        Likely sponsors
      </span>
    )
  }

  return null
}

function metaValue(value: string | null, fallback: string) {
  if (!value || !value.trim()) return fallback
  return value
}

function skillChip(skill: string) {
  const value = skill.toLowerCase()

  if (value.includes("python")) {
    return { icon: "🐍", tone: "text-[#365ECA]" }
  }
  if (value.includes("test") || value.includes("qa")) {
    return { icon: <FlaskConical className="h-3.5 w-3.5" />, tone: "text-[#6359F5]" }
  }
  if (value.includes("power") || value.includes("electr")) {
    return { icon: <Zap className="h-3.5 w-3.5" />, tone: "text-[#78B23B]" }
  }

  return { icon: null, tone: "text-[#64729A]" }
}

function MetaTile({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div className="min-w-[136px] rounded-xl border border-[#DEE3EE] bg-[#FBFCFF] px-3.5 py-2">
      <div className="flex items-center gap-3">
        <span className="text-[#516287]">{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-[#1F2D52]">{title}</p>
          <p className="truncate text-[11px] text-[#6D7B9F]">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

export default function JobCard({
  job,
  hasPrimaryResume,
  analysisIndex = -1,
  matchScore: matchScoreProp,
  isMatchScoreLoading = false,
  now: nowProp,
}: JobCardProps) {
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
  const accentClass =
    analysisIndex >= 0
      ? ACCENT_GRADIENTS[analysisIndex % ACCENT_GRADIENTS.length]
      : ACCENT_GRADIENTS[hashAccent(job.id)]
  const router = useRouter()
  const { primaryResume } = useResumeContext()
  const showResumeSignal =
    typeof hasPrimaryResume === "boolean" ? hasPrimaryResume : Boolean(primaryResume)

  const resolvedMatchScore =
    matchScoreProp ?? ("match_score" in job ? (job.match_score ?? null) : null)

  const companyName = job.company?.name ?? "Unknown company"
  const companyDomain = job.company?.domain ?? null
  const companyLogoUrl = job.company?.logo_url ?? null

  const cardView = resolveJobCardView(job)
  const visibleSkills = cardView.skills.slice(0, 4)
  const hiddenSkillsCount = Math.max(0, cardView.skills.length - visibleSkills.length)
  const salaryLabel = cardView.salary_label
  const displayTitle = cardView.title
  const experienceLabel = useMemo(
    () =>
      extractExperienceLabel(job.description) ??
      (cardView.seniority_label ? `${cardView.seniority_label} level` : null),
    [cardView.seniority_label, job.description]
  )

  async function handleBookmark() {
    if (saving) return
    setSaving(true)

    try {
      await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          companyName,
          companyLogoUrl: companyLogoUrl ?? undefined,
          jobTitle: job.title,
          applyUrl: job.apply_url,
          status: "saved",
          source: "hireoven",
          matchScore: resolvedMatchScore?.overall_score ?? null,
        }),
      })
      setSaved(true)
    } catch {
      // Preserve current behavior.
    } finally {
      setSaving(false)
    }
  }

  async function shareJob() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${job.title} at ${companyName}`,
          url: job.apply_url,
        })
        return
      }
    } catch {
      return
    }

    await navigator.clipboard.writeText(job.apply_url)
  }

  return (
    <>
      <article
        ref={h1bAttachRef as (node: HTMLElement | null) => void}
        role="button"
        tabIndex={0}
        onClick={() => router.push(`/dashboard/jobs/${job.id}`)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            router.push(`/dashboard/jobs/${job.id}`)
          }
        }}
        className={cn(
          "job-card-surface group relative overflow-hidden rounded-[18px] border border-[#DDE3EE] bg-white text-left shadow-[0_1px_0_rgba(15,23,42,0.03)] transition-colors duration-150",
          "hover:border-[#CBD4E8] hover:bg-[#FFFEFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8A80FA]/30"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-[4px] rounded-l-[18px] bg-gradient-to-b",
            accentClass
          )}
        />

        <div className="flex flex-col gap-3 px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5">
          <div className="flex gap-3">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl border border-[#DCE2EE] bg-white">
              <CompanyLogo
                companyName={companyName}
                domain={companyDomain}
                logoUrl={companyLogoUrl}
                className="h-9 w-9"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-[#505E84]">
                      {companyName}
                    </p>
                    <BadgeCheck className="h-4 w-4 text-[#2870FF]" />
                  </div>
                  <h3 className="mt-1 text-[1.85rem] font-semibold leading-tight tracking-[-0.03em] text-[#12244A]">
                    {displayTitle}
                  </h3>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[#58678D]">
                    {cardView.location && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 flex-shrink-0 opacity-80" />
                        {cardView.location}
                      </span>
                    )}
                    {cardView.location && (job.is_remote || job.is_hybrid) && (
                      <span className="text-[#D2D9EA]">|</span>
                    )}
                    {job.is_remote && (
                      <span className="rounded-full border border-[#D9DEF0] bg-[#EEF0FC] px-3 py-0.5 text-[11px] font-semibold text-[#273D79]">
                        Remote
                      </span>
                    )}
                    {!job.is_remote && job.is_hybrid && (
                      <span className="rounded-full border border-[#D9DEF0] bg-[#EEF0FC] px-3 py-0.5 text-[11px] font-semibold text-[#273D79]">
                        Hybrid
                      </span>
                    )}
                  </div>

                  {visibleSkills.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {visibleSkills.map((skill) => {
                        const chip = skillChip(skill)
                        return (
                          <span
                            key={skill}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE2EE] bg-[#F7F9FD] px-3 py-1 text-[12px] font-semibold text-[#273D79]"
                          >
                            <span className={chip.tone}>{chip.icon}</span>
                            {skill}
                          </span>
                        )
                      })}
                      {hiddenSkillsCount > 0 && (
                        <span className="inline-flex items-center rounded-full border border-[#D9DEF0] bg-[#EEF0FC] px-3 py-1 text-[12px] font-semibold text-[#5F71A2]">
                          +{hiddenSkillsCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-shrink-0 flex-col gap-2.5 lg:min-w-[220px] lg:items-end lg:text-right">
                  <div className="inline-flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", freshness.dot)} />
                    <span className={cn("text-[15px]", freshness.text)}>
                      {freshness.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {showResumeSignal && primaryResume?.parse_status === "complete" ? (
                      <MatchScorePill
                        score={resolvedMatchScore?.overall_score ?? null}
                        method={resolvedMatchScore?.score_method ?? null}
                        isLoading={isMatchScoreLoading}
                        size="sm"
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

                    {h1bEnabled ? (
                      <H1BPredictionBadge
                        prediction={h1bPrediction}
                        isLoading={h1bIsLoading && !h1bPrediction}
                        size="sm"
                        companyName={companyName}
                        onClick={() => setH1BDrawerOpen(true)}
                      />
                    ) : (
                      <SponsorshipBadge badgeKind={cardView.sponsorship_badge} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="flex flex-col gap-3 border-t border-[#E2E6F2] pt-3 xl:flex-row xl:items-center xl:justify-between"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center gap-3">
              <MetaTile
                icon={<WalletCards className="h-5 w-5" />}
                title={metaValue(salaryLabel, "Salary not listed")}
                subtitle={salaryLabel ? "Est. salary" : "Compensation"}
              />
              <MetaTile
                icon={<Clock3 className="h-5 w-5" />}
                title={metaValue(experienceLabel, "Not specified")}
                subtitle="Experience"
              />
              <MetaTile
                icon={<Briefcase className="h-5 w-5" />}
                title={metaValue(cardView.employment_label, "Not specified")}
                subtitle="Job type"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:border-l xl:border-[#E2E6F2] xl:pl-5">
              <Link
                href={`/dashboard/jobs/${job.id}`}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-[#DCE2EE] bg-white px-4 py-2 text-[13px] font-semibold text-[#293B67] transition-colors hover:border-[#C3CEE8] hover:bg-[#F7F9FE]"
              >
                <FileText className="h-4 w-4" />
                View details
              </Link>

              <button
                type="button"
                onClick={() => void handleBookmark()}
                disabled={saved || saving}
                className={cn(
                  "inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors disabled:cursor-not-allowed",
                  saved
                    ? "border-[#FFCAA8] bg-[#FFF1E6] text-[#FF5C18]"
                    : "border-[#DCE2EE] bg-white text-[#5C6B90] hover:border-[#C3CEE8] hover:bg-[#F7F9FE]"
                )}
                aria-label={saved ? "Saved to pipeline" : "Save to pipeline"}
              >
                <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
              </button>

              <button
                type="button"
                onClick={() => void shareJob()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#DCE2EE] bg-white text-[#5C6B90] transition-colors hover:border-[#C3CEE8] hover:bg-[#F7F9FE]"
                aria-label="Share job"
              >
                <Share2 className="h-4 w-4" />
              </button>

              <AutofillButton
                jobId={job.id}
                className="!h-10 !rounded-xl !border-[#FFD9C2] !bg-[#FFF7F2] !px-4 !text-[13px] !font-semibold !text-[#FF5C18] hover:!border-[#FFBC91] hover:!bg-[#FFF0E8]"
              />

              <a
                href={job.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl bg-[#FF5C18] px-5 py-2.5 text-[16px] font-semibold text-white transition-colors hover:bg-[#E14F0E]"
              >
                Apply directly
                <ExternalLink className="h-4 w-4" />
              </a>
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
          jobTitle={job.title}
          companyName={companyName}
          prediction={h1bPrediction}
          isLoading={h1bIsLoading && !h1bPrediction}
          onClose={() => setH1BDrawerOpen(false)}
        />
      )}
    </>
  )
}
