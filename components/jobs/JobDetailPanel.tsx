"use client"

import { useEffect, useId, useMemo, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"

const VisaIntelDrawer = dynamic(() => import("@/components/jobs/VisaIntelDrawer"), { ssr: false })
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Ghost,
  Info,
  Loader2,
  Plane,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useResumeAnalysis } from "@/lib/hooks/useResumeAnalysis"
import { getJobIntelligence } from "@/lib/jobs/intelligence"
import {
  JOB_APPLICATION_SAVED_EVENT,
  fetchJobSavedState,
  saveJobToPipeline,
} from "@/lib/applications/save-job-client"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"
import type {
  Company,
  Job,
  JobMatchScore,
  LcaSalaryComparisonLabel,
  VisaFitScoreLabel,
} from "@/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JobDetailPanelProps = {
  job: Job & { company: Company | null }
  initialMatchScore?: JobMatchScore | null
  displayTitle: string
  applyUrl: string
  sponsorsConfirmed: boolean
  sponsorshipPill: { label: string; className: string }
  /** True when the user profile warrants showing visa signals */
  showVisaSignals?: boolean
}

// ---------------------------------------------------------------------------
// Panel primitives
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
  onViewBreakdown,
  children,
}: {
  icon: React.ElementType
  label: string
  onViewBreakdown?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="px-4 pt-3 pb-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</span>
        </div>
        {onViewBreakdown && (
          <button
            type="button"
            onClick={onViewBreakdown}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-[#2563EB] transition hover:bg-blue-50 focus-visible:outline-none"
          >
            Details
            <ChevronRight className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function Divider() {
  return <div className="mx-4 border-t border-slate-100" />
}

function UnknownState({ label }: { label: string }) {
  return (
    <p className="text-[12px] text-slate-400 italic">{label}</p>
  )
}

// ---------------------------------------------------------------------------
// 1. Match Score gauge
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

function FactorBar({ label, value }: { label: string; value: number | null }) {
  const pct = value == null ? null : clamp(value)
  return (
    <div className="flex items-center gap-2">
      <span className="w-[80px] shrink-0 text-[11.5px] text-slate-600">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        {pct !== null && (
          <div
            className={cn("h-full rounded-full", pct >= 70 ? "bg-emerald-400" : pct >= 45 ? "bg-blue-400" : "bg-orange-400")}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-500">
        {pct == null ? "—" : `${pct}%`}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. Visa / Sponsorship section
// ---------------------------------------------------------------------------

const VISA_LABEL_CONFIG: Record<
  VisaFitScoreLabel,
  { classes: string; icon: React.ElementType; verdict: string }
> = {
  "Very Strong": { classes: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: ShieldCheck, verdict: "Very strong visa fit" },
  Strong:        { classes: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: ShieldCheck, verdict: "Strong visa fit" },
  Medium:        { classes: "bg-sky-50 text-sky-800 ring-sky-200",             icon: Plane,       verdict: "Possible visa fit" },
  Weak:          { classes: "bg-amber-50 text-amber-800 ring-amber-200",        icon: AlertTriangle, verdict: "Weak visa fit" },
  Blocked:       { classes: "bg-red-50 text-red-800 ring-red-200",              icon: ShieldAlert, verdict: "Sponsorship blocked" },
}

// ---------------------------------------------------------------------------
// 3. Salary intelligence
// ---------------------------------------------------------------------------

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
  const [visaDrawerOpen, setVisaDrawerOpen] = useState(false)
  const openVisaDrawer = useCallback(() => setVisaDrawerOpen(true), [])
  const closeVisaDrawer = useCallback(() => setVisaDrawerOpen(false), [])

  const intel = useMemo(() => getJobIntelligence(job), [job])

  // Sync server-preloaded score
  useEffect(() => {
    if (initialMatchScore !== undefined) setFastScore(initialMatchScore ?? null)
  }, [job.id, initialMatchScore])

  // Client-side fetch when no server score
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

  // Saved state
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

  // Derived values
  const overall = analysis?.overall_score ?? fastScore?.overall_score ?? null
  const hasDeepScore = analysis?.keywords_score != null
  const verdict = verdictText(overall)

  const factors = [
    { label: "Skills",      value: analysis?.skills_score      ?? fastScore?.skills_score       ?? null },
    { label: "Experience",  value: analysis?.experience_score  ?? fastScore?.seniority_score    ?? null },
    { label: "Education",   value: analysis?.education_score                                    ?? null },
    { label: "Location",    value: fastScore?.location_score                                    ?? null },
    { label: hasDeepScore ? "Role fit" : "Auth fit",
      value: hasDeepScore ? (analysis?.keywords_score ?? null) : (fastScore?.sponsorship_score ?? null) },
  ]

  // Visa / blocker
  const hasBlocker = intel.visa?.blockers?.some((b) => b.detected) ?? job.requires_authorization
  const visaLabel = !hasBlocker ? (intel.visa?.label ?? null) : "Blocked"
  const visaLabelConfig = visaLabel ? VISA_LABEL_CONFIG[visaLabel] : null
  const VisaIcon = visaLabelConfig?.icon

  // Salary
  const salaryIntel = intel.lcaSalary
  const salaryLabelConf = salaryIntel?.comparisonLabel ? SALARY_LABEL_CONFIG[salaryIntel.comparisonLabel] : null
  const SalaryIcon = salaryLabelConf?.icon

  // Ghost risk
  const ghostRisk = intel.ghostJobRisk
  const ghostFreshness = ghostRisk?.freshnessDays
  const ghostIsStale = typeof ghostFreshness === "number" && ghostFreshness > 45
  const ghostRiskLevel = ghostRisk?.riskLevel

  // STEM OPT
  const stemOpt = intel.stemOpt

  // Company hiring health
  const hiringHealth = intel.companyHiringHealth

  return (
    <div className="flex flex-col gap-3">
      {/* ── 1. Primary actions ── */}
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

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold ring-1 transition focus-visible:outline-none",
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
            {saved ? "Saved to pipeline" : "Save job"}
          </button>

          <Link
            href={`/dashboard/applications`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-[12px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            Track in pipeline
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>

          {/* Sponsorship status line */}
          {sponsorsConfirmed ? (
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 ring-1 ring-emerald-200/60">
              <Plane className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />
              <span className="text-[12px] font-semibold text-emerald-800">Sponsorship Available</span>
            </div>
          ) : (
            <div className={cn("flex items-center gap-1.5 rounded-lg px-3 py-2 ring-1 ring-inset ring-slate-200/60", sponsorshipPill.className)}>
              <Plane className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="text-[12px] font-semibold">{sponsorshipPill.label}</span>
            </div>
          )}
        </div>
      </PanelCard>

      {/* ── 2. Match Score ── */}
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
              <div className="mt-3 space-y-1.5">
                {factors.map((f) => (
                  <FactorBar key={f.label} label={f.label} value={f.value} />
                ))}
              </div>
              {resumeId && (
                <Link
                  href={`/dashboard/resume/analyze/${job.id}`}
                  className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#2563EB] hover:underline"
                >
                  Full breakdown <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          )}
        </SectionRow>
      </PanelCard>

      {/* ── 3. Visa / Sponsorship Intelligence ── */}
      {(showVisaSignals || hasBlocker) && (
        <PanelCard>
          <SectionRow icon={Plane} label="Visa Intelligence" onViewBreakdown={openVisaDrawer}>
            {hasBlocker ? (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 ring-1 ring-red-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden />
                <div>
                  <p className="text-[12px] font-semibold text-red-800">Sponsorship blocker detected</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-red-700/80">
                    The posting contains language suggesting sponsorship may not be available. Verify before applying.
                  </p>
                </div>
              </div>
            ) : visaLabelConfig && VisaIcon ? (
              <div>
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1", visaLabelConfig.classes)}>
                  <VisaIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {visaLabelConfig.verdict}
                </span>
                {intel.visa?.visaFitScore != null && (
                  <p className="mt-1.5 text-[11px] text-slate-500">Score: {intel.visa.visaFitScore}/100 · {intel.visa.confidence} confidence</p>
                )}
                {intel.visa?.summary && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 line-clamp-2">{intel.visa.summary}</p>
                )}
              </div>
            ) : (
              <UnknownState label="Visa fit data not yet available for this role." />
            )}
          </SectionRow>
        </PanelCard>
      )}

      {/* ── 4. Salary Intelligence ── */}
      <PanelCard>
        <SectionRow icon={Banknote} label="Salary Intelligence">
          {salaryIntel && salaryLabelConf && SalaryIcon ? (
            <div>
              <div className="flex items-center gap-1.5">
                <SalaryIcon className={cn("h-3.5 w-3.5 shrink-0", salaryLabelConf.classes)} aria-hidden />
                <span className={cn("text-[12px] font-semibold", salaryLabelConf.classes)}>
                  {salaryIntel.comparisonLabel}
                </span>
              </div>
              {salaryIntel.historicalRangeMin != null && salaryIntel.historicalRangeMax != null ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  LCA range: ${(salaryIntel.historicalRangeMin / 1000).toFixed(0)}k – ${(salaryIntel.historicalRangeMax / 1000).toFixed(0)}k
                  {salaryIntel.medianWage != null && ` · median $${(salaryIntel.medianWage / 1000).toFixed(0)}k`}
                </p>
              ) : null}
              {salaryIntel.commonWageLevel && (
                <p className="mt-0.5 text-[11px] text-slate-500">Common level: {salaryIntel.commonWageLevel}</p>
              )}
              <p className="mt-1.5 text-[11px] italic leading-relaxed text-slate-400 line-clamp-2">{salaryIntel.explanation}</p>
            </div>
          ) : (
            <UnknownState label={salaryIntel?.explanation ?? "Salary comparison data is not available yet."} />
          )}
        </SectionRow>
      </PanelCard>

      {/* ── 5. STEM OPT Readiness (visa users only) ── */}
      {showVisaSignals && (
        <PanelCard>
          <SectionRow icon={Zap} label="STEM OPT Readiness">
            {stemOpt?.eligible === true ? (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                <span className="text-[12px] font-semibold text-emerald-700">Likely eligible</span>
              </div>
            ) : stemOpt?.eligible === false ? (
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
                <span className="text-[12px] font-semibold text-amber-700">Eligibility uncertain</span>
              </div>
            ) : (
              <div>
                <UnknownState label="E-Verify and role signals not yet analyzed." />
                {stemOpt?.missingSignals && stemOpt.missingSignals.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">{stemOpt.missingSignals.join(" · ")}</p>
                )}
              </div>
            )}
            {stemOpt?.eVerifyLikely === true && (
              <p className="mt-1 text-[11px] text-slate-500">E-Verify signal present</p>
            )}
          </SectionRow>
        </PanelCard>
      )}

      {/* ── 6. Ghost Job Risk ── */}
      <PanelCard>
        <SectionRow icon={Ghost} label="Ghost Job Risk">
          {ghostIsStale || ghostRiskLevel === "high" ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
              <Ghost className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
              <p className="text-[12px] text-amber-800">
                {ghostIsStale ? `Posting is ${ghostFreshness}d old — verify it's still active.` : "High ghost-job risk detected."}
              </p>
            </div>
          ) : ghostFreshness != null ? (
            <p className="text-[12px] text-slate-600">
              Posted <span className="font-semibold">{ghostFreshness === 0 ? "today" : `${ghostFreshness}d ago`}</span> — looks fresh.
            </p>
          ) : (
            <UnknownState label="Freshness data unavailable." />
          )}
        </SectionRow>
      </PanelCard>

      {/* ── 7. Company Hiring Health ── */}
      <PanelCard>
        <SectionRow icon={Building2} label="Company Hiring Health">
          {hiringHealth?.status && hiringHealth.status !== "unknown" ? (
            <div>
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1",
                hiringHealth.status === "growing" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" :
                hiringHealth.status === "slowing" ? "bg-amber-50 text-amber-800 ring-amber-200" :
                "bg-slate-50 text-slate-700 ring-slate-200"
              )}>
                {hiringHealth.status === "growing" ? "Growing" : hiringHealth.status === "slowing" ? "Slowing" : "Steady"}
              </span>
              {hiringHealth.activeJobCount != null && (
                <p className="mt-1.5 text-[11px] text-slate-500">{hiringHealth.activeJobCount} active openings</p>
              )}
            </div>
          ) : hiringHealth?.activeJobCount != null ? (
            <p className="text-[12px] text-slate-600">
              <span className="font-semibold">{hiringHealth.activeJobCount}</span> active openings
            </p>
          ) : (
            <UnknownState label="Hiring health signals not yet available." />
          )}
        </SectionRow>
      </PanelCard>

      {/* ── 8. Application Verdict ── */}
      {intel.applicationVerdict && intel.applicationVerdict.recommendation !== "unknown" && (
        <PanelCard>
          <SectionRow icon={Briefcase} label="Application Verdict">
            <p className={cn(
              "text-[12px] font-semibold",
              intel.applicationVerdict.recommendation === "apply_now" ? "text-emerald-700" :
              intel.applicationVerdict.recommendation === "avoid" ? "text-red-700" :
              "text-slate-700"
            )}>
              {intel.applicationVerdict.recommendation === "apply_now" ? "Apply now" :
               intel.applicationVerdict.recommendation === "apply_with_tweaks" ? "Apply with tweaks" :
               intel.applicationVerdict.recommendation === "stretch_role" ? "Stretch role" :
               intel.applicationVerdict.recommendation === "avoid" ? "Not recommended" :
               intel.applicationVerdict.recommendation === "watch" ? "Monitor this role" :
               "Review carefully"}
            </p>
            {intel.applicationVerdict.nextBestAction && (
              <p className="mt-1 text-[11px] text-slate-500">{intel.applicationVerdict.nextBestAction}</p>
            )}
          </SectionRow>
        </PanelCard>
      )}

      {/* ── Visa Intelligence drawer ── */}
      {visaDrawerOpen && (
        <VisaIntelDrawer
          job={job}
          displayTitle={displayTitle}
          onClose={closeVisaDrawer}
        />
      )}
    </div>
  )
}
