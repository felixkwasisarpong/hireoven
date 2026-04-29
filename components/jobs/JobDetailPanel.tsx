"use client"

import { useEffect, useId, useMemo, useState } from "react"
import Link from "next/link"
import VisaIntelTrigger from "@/components/jobs/VisaIntelTrigger"
import RecruiterMessageDrawer from "@/components/jobs/RecruiterMessageDrawer"
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Ghost,
  Info,
  Loader2,
  MessageSquare,
  Plane,
  Plus,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useResumeAnalysis } from "@/lib/hooks/useResumeAnalysis"
import { createResumeLcaRoleAlignmentFallback, getJobIntelligence } from "@/lib/jobs/intelligence"
import {
  JOB_APPLICATION_SAVED_EVENT,
  fetchJobSavedState,
  saveJobToPipeline,
} from "@/lib/applications/save-job-client"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"
import { normalizeSkillList } from "@/lib/skills/taxonomy"
import type {
  Company,
  Job,
  JobMatchScore,
  LcaSalaryComparisonLabel,
  VisaFitScoreLabel,
} from "@/types"

type JobDetailPanelProps = {
  job: Job & { company: Company | null }
  initialMatchScore?: JobMatchScore | null
  displayTitle: string
  applyUrl: string
  sponsorsConfirmed: boolean
  sponsorshipPill: { label: string; className: string }
  showVisaSignals?: boolean
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl bg-white ring-1 ring-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.05)]", className)}>
      {children}
    </div>
  )
}

function SectionRow({
  icon: Icon,
  label,
  action,
  children,
}: {
  icon: React.ElementType
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="px-4 pt-3 pb-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Match gauge
// ---------------------------------------------------------------------------

function clamp(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function MatchGauge({ value }: { value: number | null }) {
  const gradId = useId().replace(/:/g, "")
  const size = 140
  const stroke = 12
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2
  const arcLength = Math.PI * r
  const pct = value == null ? 0 : clamp(value)
  const dash = (pct / 100) * arcLength

  return (
    <div className="relative mx-auto" style={{ width: size, height: size / 2 + 6 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-x-0 top-0">
        <defs>
          <linearGradient id={`dp-grad-${gradId}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={pct >= 70 ? "#10B981" : pct >= 45 ? "#3B82F6" : "#F97316"} />
            <stop offset="100%" stopColor={pct >= 70 ? "#34D399" : pct >= 45 ? "#60A5FA" : "#FB923C"} />
          </linearGradient>
        </defs>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#E2E8F0" strokeWidth={stroke} strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={`url(#dp-grad-${gradId})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${dash} ${arcLength}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-[40%] flex flex-col items-center">
        <span className="text-[28px] font-bold leading-none tracking-tight tabular-nums text-slate-900">
          {value == null ? "—" : `${pct}%`}
        </span>
      </div>
    </div>
  )
}

function verdictText(score: number | null) {
  if (score == null) return { label: "Upload resume to score", color: "text-slate-500" }
  if (score >= 85) return { label: "Excellent match", color: "text-emerald-700" }
  if (score >= 70) return { label: "Good match", color: "text-emerald-600" }
  if (score >= 50) return { label: "Partial match", color: "text-amber-700" }
  return { label: "Low match", color: "text-slate-500" }
}

function FactorBar({ label, value }: { label: string; value: number }) {
  const pct = clamp(value)
  return (
    <div className="flex items-center gap-2">
      <span className="w-[80px] shrink-0 text-[11.5px] text-slate-600">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full", pct >= 70 ? "bg-emerald-400" : pct >= 45 ? "bg-blue-400" : "bg-orange-400")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-500">
        {pct}%
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Visa config
// ---------------------------------------------------------------------------

const VISA_LABEL_CONFIG: Record<
  VisaFitScoreLabel,
  { classes: string; icon: React.ElementType; verdict: string }
> = {
  "Very Strong": { classes: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: ShieldCheck, verdict: "Very strong visa signal" },
  Strong:        { classes: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: ShieldCheck, verdict: "Strong visa signal" },
  Medium:        { classes: "bg-sky-50 text-sky-800 ring-sky-200",             icon: Plane,       verdict: "Possible visa signal" },
  Weak:          { classes: "bg-amber-50 text-amber-800 ring-amber-200",       icon: AlertTriangle, verdict: "Weak visa signal" },
  Blocked:       { classes: "bg-red-50 text-red-800 ring-red-200",             icon: ShieldAlert, verdict: "Sponsorship blocked" },
}

const SALARY_LABEL_CONFIG: Record<
  LcaSalaryComparisonLabel,
  { icon: React.ElementType; classes: string } | null
> = {
  Aligned:        { icon: CheckCircle2, classes: "text-emerald-700" },
  "Below Market": { icon: TrendingDown, classes: "text-amber-700" },
  "Above Market": { icon: TrendingUp,   classes: "text-sky-700" },
  Unknown:        null,
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function JobDetailPanel({
  job,
  initialMatchScore,
  displayTitle,
  applyUrl,
  sponsorsConfirmed,
  sponsorshipPill,
  showVisaSignals = false,
}: JobDetailPanelProps) {
  const { pushToast } = useToast()
  const { primaryResume } = useResumeContext()
  const resumeId = primaryResume?.parse_status === "complete" ? primaryResume.id : null
  const [fastScore, setFastScore] = useState<JobMatchScore | null>(initialMatchScore ?? null)
  const { analysis } = useResumeAnalysis(resumeId, job.id)

  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [recruiterOpen, setRecruiterOpen] = useState(false)

  const intel = useMemo(() => getJobIntelligence(job), [job])
  const resumeAlignment = useMemo(
    () => intel.resumeLcaRoleAlignment ?? createResumeLcaRoleAlignmentFallback(job, primaryResume),
    [intel.resumeLcaRoleAlignment, job, primaryResume]
  )

  useEffect(() => {
    if (initialMatchScore !== undefined) setFastScore(initialMatchScore ?? null)
  }, [job.id, initialMatchScore])

  useEffect(() => {
    if (initialMatchScore !== undefined) return
    if (!resumeId) { setFastScore(null); return }
    let cancelled = false
    fetch(`/api/match/score?jobId=${job.id}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { score?: JobMatchScore | null }).score ?? null : null))
      .then((s) => { if (!cancelled) setFastScore(s) })
      .catch(() => { if (!cancelled) setFastScore(null) })
    return () => { cancelled = true }
  }, [job.id, resumeId, initialMatchScore])

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

  async function handleSave() {
    if (saving || saved) return
    setSaving(true)
    try {
      const result = await saveJobToPipeline({
        jobId: job.id,
        companyName: job.company?.name ?? "Company",
        companyLogoUrl: job.company?.logo_url ?? null,
        jobTitle: displayTitle,
        applyUrl,
        matchScore: overall,
        source: "hireoven_detail",
      })
      if (!result.ok) {
        if (result.status === 401) pushToast({ tone: "info", title: "Sign in to save jobs", description: result.message })
        else pushToast({ tone: "error", title: "Save failed", description: result.message })
        return
      }
      setSaved(true)
      window.dispatchEvent(new CustomEvent(JOB_APPLICATION_SAVED_EVENT, { detail: { jobId: job.id } }))
      if (!result.alreadySaved) pushToast({ tone: "success", title: "Saved", description: "View it under Applications → Saved." })
    } catch (err) {
      pushToast({ tone: "error", title: "Save failed", description: err instanceof Error ? err.message : "Try again." })
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const overall = analysis?.overall_score ?? fastScore?.overall_score ?? null
  const verdict = verdictText(overall)

  // Only render factor bars that have an actual value
  const allFactors = [
    { label: "Skills",     value: analysis?.skills_score     ?? fastScore?.skills_score     ?? null },
    { label: "Experience", value: analysis?.experience_score ?? fastScore?.seniority_score  ?? null },
    { label: "Education",  value: analysis?.education_score                                 ?? null },
    { label: "Location",   value: fastScore?.location_score                                 ?? null },
    { label: analysis?.keywords_score != null ? "Role fit" : "Auth fit",
      value: analysis?.keywords_score  ?? fastScore?.sponsorship_score                      ?? null },
  ]
  const activeFactors = allFactors.filter((f): f is { label: string; value: number } => f.value != null)

  // Skills: ResumeAnalysis uses matching_skills/missing_skills; JobMatchScore uses score_breakdown
  const matchedSkills = useMemo(() => normalizeSkillList([
    ...(analysis?.matching_skills ?? []),
    ...(fastScore?.score_breakdown?.matchedSkills ?? []),
  ], 6), [analysis?.matching_skills, fastScore?.score_breakdown?.matchedSkills])

  const missingSkills = useMemo(() => normalizeSkillList([
    ...(analysis?.missing_skills ?? []),
    ...(fastScore?.score_breakdown?.missingSkills ?? []),
  ], 6), [analysis?.missing_skills, fastScore?.score_breakdown?.missingSkills])

  // Visa
  const hasBlocker = intel.visa?.blockers?.some((b) => b.detected) ?? job.requires_authorization
  const visaLabel = !hasBlocker ? (intel.visa?.label ?? null) : "Blocked"
  const visaLabelConfig = visaLabel ? VISA_LABEL_CONFIG[visaLabel] : null
  const VisaIcon = visaLabelConfig?.icon

  // Salary — only surface when there's a real comparison
  const salaryIntel = intel.lcaSalary
  const hasSalaryData =
    salaryIntel?.comparisonLabel != null &&
    salaryIntel.comparisonLabel !== "Unknown"
  const salaryLabelConf = hasSalaryData && salaryIntel?.comparisonLabel
    ? SALARY_LABEL_CONFIG[salaryIntel.comparisonLabel]
    : null
  const SalaryIcon = salaryLabelConf?.icon

  // Ghost risk — only show when we have freshness signal
  const ghostRisk = intel.ghostJobRisk
  const showGhostRisk = ghostRisk?.freshnessDays != null || ghostRisk?.riskLevel !== "unknown"
  const ghostRiskLevel = ghostRisk?.riskLevel
  const ghostTone =
    ghostRiskLevel === "high"   ? "bg-red-50 text-red-800 ring-red-200"
    : ghostRiskLevel === "medium" ? "bg-amber-50 text-amber-800 ring-amber-200"
    : ghostRiskLevel === "low"    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : "bg-slate-50 text-slate-600 ring-slate-200"
  const ghostLabel =
    ghostRiskLevel === "high"   ? "High risk"
    : ghostRiskLevel === "medium" ? "Medium risk"
    : ghostRiskLevel === "low"    ? "Low risk"
    : "Unknown"

  // Hiring health — only show when status or count is meaningful
  const hiringHealth = intel.companyHiringHealth
  const showHiringHealth =
    (hiringHealth?.status && hiringHealth.status !== "unknown") ||
    (hiringHealth?.activeJobCount != null && hiringHealth.activeJobCount > 0)

  return (
    <>
    <div className="flex flex-col gap-3">

      {/* ── Actions ── */}
      <PanelCard>
        <div className="p-4 space-y-2.5">
          <a
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(37,99,235,0.25)] transition hover:bg-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
          >
            Apply Now
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
          </a>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[12px] font-semibold ring-1 transition",
                saved
                  ? "bg-amber-50 text-amber-800 ring-amber-200"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
              )}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : saved ? (
                <BookmarkCheck className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Bookmark className="h-3.5 w-3.5" aria-hidden />
              )}
              {saved ? "Saved" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setRecruiterOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              Message
            </button>
          </div>

          <Link
            href="/dashboard/applications"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-[12px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            Track in pipeline
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>

          {/* Sponsorship status — only when data exists */}
          {(sponsorsConfirmed || sponsorshipPill.label !== "Sponsorship not specified") && (
            sponsorsConfirmed ? (
              <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 ring-1 ring-emerald-200/60">
                <Plane className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />
                <span className="text-[12px] font-semibold text-emerald-800">Historical sponsorship signal</span>
              </div>
            ) : (
              <div className={cn("flex items-center gap-1.5 rounded-lg px-3 py-2 ring-1 ring-inset ring-slate-200/60", sponsorshipPill.className)}>
                <Plane className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="text-[12px] font-semibold">{sponsorshipPill.label}</span>
              </div>
            )
          )}
        </div>
      </PanelCard>

      {/* ── Match Score ── */}
      <PanelCard>
        <SectionRow icon={Info} label="Match Score">
          {resumeId === null ? (
            <div className="pb-1">
              <p className="text-[12px] text-slate-500">Upload your resume to see how well you match this role.</p>
              <Link href="/dashboard/resume" className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#2563EB] hover:underline">
                Upload resume <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          ) : (
            <div>
              <MatchGauge value={overall} />
              <p className={cn("mt-1 text-center text-[12px] font-semibold", verdict.color)}>{verdict.label}</p>

              {activeFactors.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {activeFactors.map((f) => (
                    <FactorBar key={f.label} label={f.label} value={f.value} />
                  ))}
                </div>
              )}

              {/* Skill match pills from the match score */}
              {matchedSkills.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Matched skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {matchedSkills.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100"
                      >
                        <Check className="h-3 w-3" aria-hidden />
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {missingSkills.length > 0 && (
                <div className="mt-2.5">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Skills to add</p>
                  <div className="flex flex-wrap gap-1.5">
                    {missingSkills.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-600 ring-1 ring-orange-100"
                      >
                        <Plus className="h-3 w-3" aria-hidden />
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <Link
                href={`/dashboard/resume/analyze/${job.id}`}
                className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#2563EB] hover:underline"
              >
                Full breakdown <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </SectionRow>
      </PanelCard>

      {/* ── Visa Intelligence — moved to middle, shown inline ── */}
      {(showVisaSignals || hasBlocker) && (() => {
        const fitScore = intel.visa?.visaFitScore ?? null
        const barColor =
          fitScore == null ? "bg-slate-300"
          : fitScore >= 70  ? "bg-emerald-500"
          : fitScore >= 45  ? "bg-blue-500"
          : "bg-amber-500"

        // E-Verify: only show when we have a real positive signal
        const eVerifyParticipates = intel.visa?.eVerifySignal?.status === "participates"
        const eVerifyLikely = intel.stemOpt?.eVerifyLikely === true
        const showEVerify = eVerifyParticipates || eVerifyLikely

        // Cap-exempt: only show when detected
        const capExempt = intel.visa?.capExempt?.isLikelyCapExempt === true

        // Top positive signals (exclude very generic ones)
        const positiveSignals = (intel.visa?.positiveSignals ?? [])
          .filter((s) => s.label && s.label.length < 80)
          .slice(0, 3)

        return (
          <PanelCard>
            <SectionRow
              icon={Plane}
              label="Visa Intelligence"
              action={
                <VisaIntelTrigger job={job} displayTitle={displayTitle} />
              }
            >
              {hasBlocker ? (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 ring-1 ring-red-200">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden />
                  <div>
                    <p className="text-[12px] font-semibold text-red-800">Sponsorship blocker detected</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-red-700/80">
                      Posting language suggests sponsorship may not be available. Verify before applying.
                    </p>
                  </div>
                </div>
              ) : visaLabelConfig && VisaIcon ? (
                <div className="space-y-3">
                  {/* Label badge */}
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1", visaLabelConfig.classes)}>
                    <VisaIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {visaLabelConfig.verdict}
                  </span>

                  {/* Score bar */}
                  {fitScore != null && (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Fit score</span>
                        <span className="text-[11px] font-semibold tabular-nums text-slate-700">{fitScore}/100 · {intel.visa?.confidence} confidence</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn("h-full rounded-full transition-[width] duration-500", barColor)}
                          style={{ width: `${fitScore}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Positive signals */}
                  {positiveSignals.length > 0 && (
                    <div className="space-y-1.5">
                      {positiveSignals.map((s) => (
                        <div key={s.label} className="flex items-start gap-1.5">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                          <p className="text-[11.5px] leading-relaxed text-slate-600">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* E-Verify */}
                  {showEVerify && (
                    <div className="rounded-lg bg-sky-50 px-3 py-2 ring-1 ring-sky-200">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-500 mb-1">E-Verify</p>
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-sky-500" aria-hidden />
                        <p className="text-[12px] font-semibold text-sky-800">
                          {eVerifyParticipates ? "Participant confirmed" : "Likely participant"}
                        </p>
                      </div>
                      {intel.visa?.eVerifySignal?.confidence && intel.visa.eVerifySignal.confidence !== "unknown" && (
                        <p className="mt-0.5 text-[10.5px] text-sky-600">
                          {intel.visa.eVerifySignal.confidence} confidence · {intel.visa.eVerifySignal.source === "independent_source" ? "independent data" : "inferred"}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Cap-exempt */}
                  {capExempt && (
                    <div className="flex items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-2 ring-1 ring-violet-200">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
                      <p className="text-[12px] font-semibold text-violet-800">Possible cap-exempt pathway</p>
                    </div>
                  )}

                  {intel.visa?.summary && (
                    <p className="text-[11px] leading-relaxed text-slate-500 line-clamp-2">{intel.visa.summary}</p>
                  )}
                </div>
              ) : (
                <p className="text-[12px] italic text-slate-400">Visa fit data not yet available for this role.</p>
              )}
            </SectionRow>
          </PanelCard>
        )
      })()}

      {/* ── Resume Alignment — only when score is available ── */}
      {resumeAlignment.alignmentScore != null && (
        <PanelCard>
          <SectionRow icon={ClipboardCheck} label="Resume Alignment">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[22px] font-bold leading-none text-slate-900">
                    {resumeAlignment.alignmentScore}%
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {resumeAlignment.roleFamily ?? "Role alignment"} · {resumeAlignment.confidence} confidence
                  </p>
                </div>
                <span className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                  resumeAlignment.alignmentScore >= 75
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : resumeAlignment.alignmentScore >= 50
                      ? "bg-blue-50 text-blue-800 ring-blue-200"
                      : "bg-amber-50 text-amber-800 ring-amber-200"
                )}>
                  {resumeAlignment.alignmentScore >= 75 ? "Strong fit" : resumeAlignment.alignmentScore >= 50 ? "Can tailor" : "Needs tailoring"}
                </span>
              </div>

              {resumeAlignment.strongMatches.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Strong matches</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {resumeAlignment.strongMatches.slice(0, 5).map((keyword) => (
                      <span key={keyword} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {resumeAlignment.missingKeywords.length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  Missing: {resumeAlignment.missingKeywords.slice(0, 4).join(", ")}.
                </p>
              )}

              <Link
                href={`/dashboard/resume/studio?mode=tailor&jobId=${job.id}`}
                className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#2563EB] hover:underline"
              >
                Tailor resume <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </SectionRow>
        </PanelCard>
      )}

      {/* ── Salary Intelligence — only when real comparison exists ── */}
      {hasSalaryData && salaryLabelConf && SalaryIcon && (
        <PanelCard>
          <SectionRow icon={Banknote} label="Salary Intelligence">
            <div>
              <div className="flex items-center gap-1.5">
                <SalaryIcon className={cn("h-3.5 w-3.5 shrink-0", salaryLabelConf.classes)} aria-hidden />
                <span className={cn("text-[12px] font-semibold", salaryLabelConf.classes)}>
                  {salaryIntel?.comparisonLabel}
                </span>
              </div>
              {salaryIntel?.historicalRangeMin != null && salaryIntel.historicalRangeMax != null && (
                <p className="mt-1 text-[11px] text-slate-500">
                  LCA range: ${(salaryIntel.historicalRangeMin / 1000).toFixed(0)}k–${(salaryIntel.historicalRangeMax / 1000).toFixed(0)}k
                  {salaryIntel.medianWage != null && ` · median $${(salaryIntel.medianWage / 1000).toFixed(0)}k`}
                </p>
              )}
              {salaryIntel?.commonWageLevel && (
                <p className="mt-0.5 text-[11px] text-slate-500">Common level: {salaryIntel.commonWageLevel}</p>
              )}
              {salaryIntel?.explanation && (
                <p className="mt-1.5 text-[11px] italic leading-relaxed text-slate-400 line-clamp-2">{salaryIntel.explanation}</p>
              )}
            </div>
          </SectionRow>
        </PanelCard>
      )}

      {/* ── Ghost Job Risk — only when freshness data exists ── */}
      {showGhostRisk && ghostRisk && (
        <PanelCard>
          <SectionRow icon={Ghost} label="Hiring freshness">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1", ghostTone)}>
                  <Ghost className="h-3 w-3" aria-hidden />
                  {ghostLabel}
                  {ghostRisk.score != null && ` · ${ghostRisk.score}/100`}
                </span>
                {ghostRisk.freshnessDays != null && (
                  <span className="text-[11px] text-slate-400">
                    {ghostRisk.freshnessDays === 0 ? "Posted today" : `${ghostRisk.freshnessDays}d old`}
                  </span>
                )}
              </div>
              {ghostRisk.recommendedAction && (
                <p className="mt-2 text-[12px] leading-relaxed text-slate-600">{ghostRisk.recommendedAction}</p>
              )}
              {ghostRisk.reasons.length > 0 && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                  {ghostRisk.reasons.slice(0, 2).join(" · ")}
                </p>
              )}
            </div>
          </SectionRow>
        </PanelCard>
      )}

      {/* ── Company Hiring Health — only when meaningful ── */}
      {showHiringHealth && (
        <PanelCard>
          <SectionRow icon={Building2} label="Company Hiring">
            {hiringHealth?.status && hiringHealth.status !== "unknown" ? (
              <div>
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1",
                  hiringHealth.status === "growing" ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : hiringHealth.status === "slowing" ? "bg-amber-50 text-amber-800 ring-amber-200"
                  : "bg-slate-50 text-slate-700 ring-slate-200"
                )}>
                  {hiringHealth.status === "growing" ? "Growing" : hiringHealth.status === "slowing" ? "Slowing" : "Steady"}
                </span>
                {hiringHealth.activeJobCount != null && (
                  <p className="mt-1.5 text-[11px] text-slate-500">{hiringHealth.activeJobCount} active openings</p>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-slate-600">
                <span className="font-semibold">{hiringHealth?.activeJobCount}</span> active openings
              </p>
            )}
          </SectionRow>
        </PanelCard>
      )}

      {/* ── Application Verdict — only when a real recommendation exists ── */}
      {intel.applicationVerdict && intel.applicationVerdict.recommendation !== "unknown" && (
        <PanelCard>
          <SectionRow icon={Briefcase} label="Application Verdict">
            <p className={cn(
              "text-[12px] font-semibold",
              intel.applicationVerdict.recommendation === "apply_now" ? "text-emerald-700"
              : intel.applicationVerdict.recommendation === "avoid" || intel.applicationVerdict.recommendation === "skip" ? "text-red-700"
              : "text-slate-700"
            )}>
              {intel.applicationVerdict.verdict !== "Unknown"
                ? intel.applicationVerdict.verdict
                : intel.applicationVerdict.recommendation === "apply_now" ? "Apply Today"
                : intel.applicationVerdict.recommendation === "apply_with_tweaks" ? "Apply, But Customize Resume"
                : intel.applicationVerdict.recommendation === "avoid" ? "High Risk"
                : intel.applicationVerdict.recommendation === "skip" ? "Skip"
                : intel.applicationVerdict.recommendation === "watch" ? "Maybe"
                : "Review carefully"}
            </p>
            {intel.applicationVerdict.recommendedNextAction && (
              <p className="mt-1 text-[11px] text-slate-500">{intel.applicationVerdict.recommendedNextAction}</p>
            )}
            {intel.applicationVerdict.warnings.length > 0 && (
              <p className="mt-1 text-[11px] text-amber-700">{intel.applicationVerdict.warnings.slice(0, 1).join(" ")}</p>
            )}
          </SectionRow>
        </PanelCard>
      )}

    </div>

    <RecruiterMessageDrawer
      open={recruiterOpen}
      onClose={() => setRecruiterOpen(false)}
      jobTitle={displayTitle}
      company={job.company?.name ?? ""}
    />
    </>
  )
}
