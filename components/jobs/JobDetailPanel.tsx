"use client"

import { useEffect, useMemo, useState } from "react"
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
  ExternalLink,
  Ghost,
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
  getMatchVerdict,
  resolveOverallMatchScore,
} from "@/lib/jobs/match-score-display"
import { resolveH1BSponsorshipDisplay } from "@/lib/jobs/sponsorship-employer-signal"
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
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function CircleScore({ value }: { value: number | null }) {
  const size = 80
  const stroke = 7
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const pct = value == null ? 0 : clamp(value)
  const dash = (pct / 100) * circumference
  const fillColor = pct >= 70 ? "#10B981" : pct >= 45 ? "#F97316" : "#EF4444"

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="#F1F5F9" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={value == null ? "#E2E8F0" : fillColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[20px] font-bold leading-none tabular-nums text-slate-900">
          {value == null ? "–" : `${pct}`}
        </span>
        {value != null && (
          <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">%</span>
        )}
      </div>
    </div>
  )
}

function FactorBar({ label, value }: { label: string; value: number }) {
  const pct = clamp(value)
  const barColor = pct >= 70 ? "bg-emerald-400" : pct >= 45 ? "bg-orange-400" : "bg-red-400"
  return (
    <div className="grid grid-cols-[64px_1fr_24px] items-center gap-2">
      <span className="truncate text-[11.5px] text-slate-500">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-right text-[11px] font-semibold tabular-nums text-slate-500">{pct}</span>
    </div>
  )
}

// ─── Visa / salary config ───────────────────────────────────────────────────

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

// ─── Section header primitive ───────────────────────────────────────────────

function IntelLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400">{children}</p>
      {action}
    </div>
  )
}

const sectionCls = "border-t border-slate-100 px-5 py-5"

// ─── Main component ─────────────────────────────────────────────────────────

export default function JobDetailPanel({
  job,
  initialMatchScore,
  displayTitle,
  applyUrl,
  sponsorsConfirmed,
  sponsorshipPill,
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

  // ─── Derived ──────────────────────────────────────────────────────────────

  const overall = resolveOverallMatchScore({
    analysisOverallScore: analysis?.overall_score,
    preferredScore: fastScore,
    fallbackScore: initialMatchScore ?? null,
    rawData: job.raw_data,
  })
  const verdict = getMatchVerdict(overall)

  const allFactors = [
    { label: "Skills",     value: analysis?.skills_score     ?? fastScore?.skills_score     ?? null },
    { label: "Experience", value: analysis?.experience_score ?? fastScore?.seniority_score  ?? null },
    { label: "Education",  value: analysis?.education_score                                 ?? null },
    { label: "Location",   value: fastScore?.location_score                                 ?? null },
    { label: analysis?.keywords_score != null ? "Role fit" : "Auth fit",
      value: analysis?.keywords_score  ?? fastScore?.sponsorship_score                      ?? null },
  ]
  const activeFactors = allFactors.filter((f): f is { label: string; value: number } => f.value != null)

  const matchedSkills = useMemo(() => normalizeSkillList([
    ...(analysis?.matching_skills ?? []),
    ...(fastScore?.score_breakdown?.matchedSkills ?? []),
  ], 6), [analysis?.matching_skills, fastScore?.score_breakdown?.matchedSkills])

  const missingSkills = useMemo(() => normalizeSkillList([
    ...(analysis?.missing_skills ?? []),
    ...(fastScore?.score_breakdown?.missingSkills ?? []),
  ], 6), [analysis?.missing_skills, fastScore?.score_breakdown?.missingSkills])

  const hasBlocker = intel.visa?.blockers?.some((b) => b.detected) ?? job.requires_authorization
  const visaLabel = !hasBlocker ? (intel.visa?.label ?? null) : "Blocked"
  const visaLabelConfig = visaLabel ? VISA_LABEL_CONFIG[visaLabel] : null
  const VisaIcon = visaLabelConfig?.icon
  const visaFitScore = intel.visa?.visaFitScore ?? null
  const visaTopSignal = (intel.visa?.positiveSignals ?? []).find((s) => s.label && s.label.length < 80)

  const salaryIntel = intel.lcaSalary
  const hasSalaryData = salaryIntel?.comparisonLabel != null && salaryIntel.comparisonLabel !== "Unknown"
  const salaryLabelConf = hasSalaryData && salaryIntel?.comparisonLabel
    ? SALARY_LABEL_CONFIG[salaryIntel.comparisonLabel]
    : null
  const SalaryIcon = salaryLabelConf?.icon

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

  const hiringHealth = intel.companyHiringHealth
  const showHiringHealth =
    (hiringHealth?.status && hiringHealth.status !== "unknown") ||
    (hiringHealth?.activeJobCount != null && hiringHealth.activeJobCount > 0)

  const resolvedSponsorshipDisplay = useMemo(
    () => resolveH1BSponsorshipDisplay({ ...job, company: job.company ?? undefined }),
    [job]
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_4px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/60">

        {/* ── Actions ── */}
        <div className="space-y-2.5 p-5">
          <a
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-[13.5px] font-bold text-white shadow-[0_4px_16px_rgba(249,115,22,0.3)] transition hover:bg-orange-400 active:scale-[0.98]"
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
                "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[12.5px] font-semibold ring-1 transition",
                saved
                  ? "bg-amber-50 text-amber-700 ring-amber-200"
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
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-[12.5px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              Message
            </button>
          </div>

          <Link
            href="/dashboard/applications"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-[12px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            Track in pipeline
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>

          {resolvedSponsorshipDisplay ? (
            <div
              className={cn(
                "flex items-start gap-2 rounded-xl px-3.5 py-2.5 ring-1 ring-inset",
                resolvedSponsorshipDisplay.tone === "emerald"
                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200/60"
                  : resolvedSponsorshipDisplay.tone === "sky"
                    ? "bg-sky-50 text-sky-800 ring-sky-200/60"
                    : resolvedSponsorshipDisplay.tone === "amber"
                      ? "bg-amber-50 text-amber-800 ring-amber-200/60"
                      : "bg-rose-50 text-rose-800 ring-rose-200/60"
              )}
            >
              {resolvedSponsorshipDisplay.tone === "rose" ? (
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <Plane className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="text-[12px] font-semibold">{resolvedSponsorshipDisplay.label}</p>
                <p className="text-[10.5px] leading-relaxed opacity-80">{resolvedSponsorshipDisplay.sublabel}</p>
              </div>
            </div>
          ) : (sponsorsConfirmed || sponsorshipPill.label !== "Sponsorship not specified") ? (
            sponsorsConfirmed ? (
              <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3.5 py-2.5 ring-1 ring-emerald-200/60">
                <Plane className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                <span className="text-[12px] font-semibold text-emerald-800">Historical H-1B signal</span>
              </div>
            ) : (
              <div className={cn("flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 ring-1 ring-inset", sponsorshipPill.className)}>
                <Plane className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="text-[12px] font-semibold">{sponsorshipPill.label}</span>
              </div>
            )
          ) : null}
        </div>

        {/* ── Match Score ── */}
        <div className={sectionCls}>
          {resumeId === null ? (
            <div className="flex flex-col items-center py-2 text-center">
              <div className="flex h-[80px] w-[80px] items-center justify-center rounded-full bg-slate-50 ring-2 ring-slate-200 ring-dashed">
                <span className="text-[28px] font-bold text-slate-300">–</span>
              </div>
              <p className="mt-3 text-[13.5px] font-semibold text-slate-800">See your match score</p>
              <p className="mt-1 max-w-[200px] text-[12px] leading-relaxed text-slate-400">
                Upload a resume to get a personalized fit score for this role.
              </p>
              <Link
                href="/dashboard/resume"
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-orange-400"
              >
                Upload resume
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          ) : (
            <div>
              {/* Score + verdict row */}
              <div className="flex items-center gap-4">
                <CircleScore value={overall} />
                <div className="min-w-0">
                  <p className={cn("text-[16px] font-bold leading-tight", verdict.colorClass)}>
                    {verdict.label}
                  </p>
                  {activeFactors.length > 0 && (
                    <p className="mt-0.5 text-[11.5px] text-slate-400">
                      {activeFactors.length} factor{activeFactors.length !== 1 ? "s" : ""} analyzed
                    </p>
                  )}
                  <Link
                    href={`/dashboard/resume/analyze/${job.id}`}
                    className="mt-1.5 inline-flex items-center gap-0.5 text-[11.5px] font-semibold text-orange-600 hover:underline"
                  >
                    Full breakdown <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              {/* Factor bars */}
              {activeFactors.length > 0 && (
                <div className="mt-4 space-y-2.5">
                  {activeFactors.map((f) => (
                    <FactorBar key={f.label} label={f.label} value={f.value} />
                  ))}
                </div>
              )}

              {/* Skill pills */}
              {(matchedSkills.length > 0 || missingSkills.length > 0) && (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  {matchedSkills.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-semibold text-slate-500">Skills you have</p>
                      <div className="flex flex-wrap gap-1.5">
                        {matchedSkills.map((skill) => (
                          <span
                            key={skill}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100"
                          >
                            <Check className="h-3 w-3 shrink-0" aria-hidden />
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {missingSkills.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-semibold text-slate-500">Consider adding</p>
                      <div className="flex flex-wrap gap-1.5">
                        {missingSkills.map((skill) => (
                          <span
                            key={skill}
                            className="inline-flex items-center gap-1 rounded-lg bg-orange-50 px-2.5 py-1 text-[11px] font-medium text-orange-600 ring-1 ring-orange-100"
                          >
                            <Plus className="h-3 w-3 shrink-0" aria-hidden />
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Visa Intelligence — always shown, full detail lives in the drawer ── */}
        <div className={sectionCls}>
          <IntelLabel>Visa intelligence</IntelLabel>
          <VisaIntelTrigger job={job} displayTitle={displayTitle}>
            <div className="group rounded-xl bg-slate-50 px-4 py-3.5 ring-1 ring-slate-200/60 transition hover:bg-white hover:ring-orange-300/60">
              {hasBlocker ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
                    <div>
                      <p className="text-[13px] font-semibold text-red-800">Blocker detected</p>
                      <p className="mt-0.5 text-[11.5px] text-slate-500">Review posting before applying</p>
                    </div>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-orange-400" aria-hidden />
                </div>
              ) : visaLabelConfig && VisaIcon ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ring-1", visaLabelConfig.classes)}>
                        <VisaIcon className="h-3 w-3 shrink-0" aria-hidden />
                        {visaLabelConfig.verdict}
                      </span>
                      {visaFitScore != null && (
                        <span className="text-[11px] font-semibold tabular-nums text-slate-400">
                          {visaFitScore}/100
                        </span>
                      )}
                    </div>
                    {visaTopSignal && (
                      <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500 line-clamp-2">
                        {visaTopSignal.label}
                      </p>
                    )}
                    <p className="mt-2 text-[11.5px] font-semibold text-orange-600">Full analysis →</p>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-orange-400" aria-hidden />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-slate-700">Visa fit analysis</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-400">Tap to view full intelligence report</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-orange-400" aria-hidden />
                </div>
              )}
            </div>
          </VisaIntelTrigger>
        </div>

        {/* ── Resume Alignment ── */}
        {resumeAlignment.alignmentScore != null && (
          <div className={sectionCls}>
            <IntelLabel>Resume alignment</IntelLabel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[22px] font-bold leading-none text-slate-900">
                  {resumeAlignment.alignmentScore}%
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {resumeAlignment.roleFamily ?? "Role alignment"} · {resumeAlignment.confidence} confidence
                </p>
              </div>
              <span className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                resumeAlignment.alignmentScore >= 75
                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : resumeAlignment.alignmentScore >= 50
                    ? "bg-orange-50 text-orange-800 ring-orange-200"
                    : "bg-amber-50 text-amber-800 ring-amber-200"
              )}>
                {resumeAlignment.alignmentScore >= 75 ? "Strong fit" : resumeAlignment.alignmentScore >= 50 ? "Can tailor" : "Needs work"}
              </span>
            </div>

            {resumeAlignment.strongMatches.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Strong matches</p>
                <div className="flex flex-wrap gap-1.5">
                  {resumeAlignment.strongMatches.slice(0, 5).map((keyword) => (
                    <span key={keyword} className="rounded-lg bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100">
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {resumeAlignment.missingKeywords.length > 0 && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Missing: {resumeAlignment.missingKeywords.slice(0, 4).join(", ")}.
              </p>
            )}

            <Link
              href={`/dashboard/resume/studio?mode=tailor&jobId=${job.id}`}
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-orange-600 hover:underline"
            >
              Tailor resume <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}

        {/* ── Salary Intelligence ── */}
        {hasSalaryData && salaryLabelConf && SalaryIcon && (
          <div className={sectionCls}>
            <IntelLabel>Salary intelligence</IntelLabel>
            <div className="flex items-center gap-1.5">
              <SalaryIcon className={cn("h-3.5 w-3.5 shrink-0", salaryLabelConf.classes)} aria-hidden />
              <span className={cn("text-[12.5px] font-semibold", salaryLabelConf.classes)}>
                {salaryIntel?.comparisonLabel}
              </span>
            </div>
            {salaryIntel?.historicalRangeMin != null && salaryIntel.historicalRangeMax != null && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                LCA range: ${(salaryIntel.historicalRangeMin / 1000).toFixed(0)}k–${(salaryIntel.historicalRangeMax / 1000).toFixed(0)}k
                {salaryIntel.medianWage != null && ` · median $${(salaryIntel.medianWage / 1000).toFixed(0)}k`}
              </p>
            )}
            {salaryIntel?.commonWageLevel && (
              <p className="mt-0.5 text-[11px] text-slate-400">Common level: {salaryIntel.commonWageLevel}</p>
            )}
            {salaryIntel?.explanation && (
              <p className="mt-1.5 text-[11px] italic leading-relaxed text-slate-400 line-clamp-2">
                {salaryIntel.explanation}
              </p>
            )}
          </div>
        )}

        {/* ── Ghost Job Risk ── */}
        {showGhostRisk && ghostRisk && (
          <div className={sectionCls}>
            <IntelLabel>Hiring freshness</IntelLabel>
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
        )}

        {/* ── Company Hiring Health ── */}
        {showHiringHealth && (
          <div className={sectionCls}>
            <IntelLabel>Company hiring</IntelLabel>
            {hiringHealth?.status && hiringHealth.status !== "unknown" ? (
              <div>
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1",
                  hiringHealth.status === "growing" ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : hiringHealth.status === "slowing" ? "bg-amber-50 text-amber-800 ring-amber-200"
                  : "bg-slate-50 text-slate-700 ring-slate-200"
                )}>
                  <Building2 className="h-3 w-3" aria-hidden />
                  {hiringHealth.status === "growing" ? "Growing" : hiringHealth.status === "slowing" ? "Slowing" : "Steady"}
                </span>
                {hiringHealth.activeJobCount != null && (
                  <p className="mt-2 text-[11px] text-slate-400">{hiringHealth.activeJobCount} active openings</p>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-slate-600">
                <span className="font-semibold">{hiringHealth?.activeJobCount}</span> active openings
              </p>
            )}
          </div>
        )}

        {/* ── Application Verdict ── */}
        {intel.applicationVerdict && intel.applicationVerdict.recommendation !== "unknown" && (
          <div className={sectionCls}>
            <IntelLabel>Application verdict</IntelLabel>
            <p className={cn(
              "text-[13px] font-bold",
              intel.applicationVerdict.recommendation === "apply_now"   ? "text-emerald-700"
              : intel.applicationVerdict.recommendation === "avoid"
                || intel.applicationVerdict.recommendation === "skip"  ? "text-red-600"
              : "text-slate-700"
            )}>
              {intel.applicationVerdict.verdict !== "Unknown"
                ? intel.applicationVerdict.verdict
                : intel.applicationVerdict.recommendation === "apply_now"       ? "Apply Today"
                : intel.applicationVerdict.recommendation === "apply_with_tweaks" ? "Apply — Customize Resume"
                : intel.applicationVerdict.recommendation === "avoid"           ? "High Risk"
                : intel.applicationVerdict.recommendation === "skip"            ? "Skip"
                : intel.applicationVerdict.recommendation === "watch"           ? "Watch"
                : "Review carefully"}
            </p>
            {intel.applicationVerdict.recommendedNextAction && (
              <p className="mt-1 text-[11.5px] text-slate-500">{intel.applicationVerdict.recommendedNextAction}</p>
            )}
            {intel.applicationVerdict.warnings.length > 0 && (
              <p className="mt-1.5 text-[11px] text-amber-600">{intel.applicationVerdict.warnings.slice(0, 1).join(" ")}</p>
            )}
          </div>
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
