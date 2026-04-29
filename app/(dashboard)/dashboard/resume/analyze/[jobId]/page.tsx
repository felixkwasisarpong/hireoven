"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Plus,
  Sparkles,
  X,
} from "lucide-react"
import AnalysisScoreCircle from "@/components/resume/AnalysisScoreCircle"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { PLAN_NAMES } from "@/lib/gates"
import { useFeatureAccess } from "@/lib/hooks/useFeatureAccess"
import { useResumeAnalysis } from "@/lib/hooks/useResumeAnalysis"
import { cn } from "@/lib/utils"
import type { ApplyRecommendation, Company, Job, ResumeAnalysis } from "@/types"

type JobWithCompany = Job & { company: Company }

// ─── Config maps ─────────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<string, string> = {
  strong_match: "Strong match",
  good_match: "Good match",
  partial_match: "Partial match",
  weak_match: "Weak match",
}

const APPLY_CONFIG: Record<ApplyRecommendation, { label: string; sub: string; tone: string }> = {
  apply_now: {
    label: "Apply now",
    sub: "You're a strong fit — go for it.",
    tone: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  },
  apply_with_tweaks: {
    label: "Apply after a few tweaks",
    sub: "Small resume updates could significantly improve your chances.",
    tone: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  stretch_role: {
    label: "Stretch role",
    sub: "Apply if you're confident — expect tough questions on the gaps.",
    tone: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  skip: {
    label: "Consider skipping",
    sub: "Significant gaps exist. Build more experience first.",
    tone: "bg-red-50 text-red-800 ring-red-200",
  },
}

// ─── Loading state ────────────────────────────────────────────────────────────

const STEPS = [
  "Reading your resume…",
  "Analysing job requirements…",
  "Comparing skills and experience…",
  "Generating recommendations…",
  "Finalising your match score…",
]

function AnalysisLoader({ isAnalyzing }: { isAnalyzing: boolean }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!isAnalyzing) return
    setStep(0)
    const interval = window.setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1))
    }, 1800)
    return () => window.clearInterval(interval)
  }, [isAnalyzing])

  return (
    <div className="flex flex-col items-center justify-center gap-8 py-20">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-slate-100 border-t-orange-500" />
      </div>
      <div className="w-full max-w-[260px] space-y-3">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-3">
            {i < step ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : i === step ? (
              <div className="h-4 w-4 shrink-0 rounded-full bg-orange-100 ring-2 ring-orange-400" />
            ) : (
              <div className="h-4 w-4 shrink-0 rounded-full ring-1 ring-slate-200" />
            )}
            <span
              className={cn(
                "text-[13px]",
                i < step && "text-emerald-600",
                i === step && "font-semibold text-slate-900",
                i > step && "text-slate-400"
              )}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-slate-400">Usually takes 5–15 seconds</p>
    </div>
  )
}

// ─── Factor tile ──────────────────────────────────────────────────────────────

function FactorTile({ label, score }: { label: string; score: number | null }) {
  const v = score ?? 0
  const barColor = v >= 70 ? "bg-emerald-400" : v >= 45 ? "bg-orange-400" : "bg-red-400"
  const numColor = v >= 70 ? "text-emerald-600" : v >= 45 ? "text-orange-500" : "text-red-500"
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-4 ring-1 ring-slate-200/50">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={cn("mt-1.5 text-[28px] font-bold leading-none tabular-nums", numColor)}>{v}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700", barColor)}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  )
}

// ─── Main analysis view ───────────────────────────────────────────────────────

const sec = "border-t border-slate-100 px-6 py-7"

function FullAnalysisView({ analysis, job }: { analysis: ResumeAnalysis; job: JobWithCompany }) {
  const applyConfig = analysis.apply_recommendation ? APPLY_CONFIG[analysis.apply_recommendation] : null

  const sortedRecs = [...(analysis.recommendations ?? [])].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.priority] - order[b.priority]
  })

  const expMatch = analysis.experience_match

  const missingKws = analysis.missing_keywords ?? []
  const matchingKws = analysis.matching_keywords ?? []

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_4px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/60">

      {/* ── Overall score ── */}
      <section className="px-6 py-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
          <div className="shrink-0 text-center">
            <AnalysisScoreCircle score={analysis.overall_score ?? 0} size="lg" animated />
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              Overall match
            </p>
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-[26px] font-bold tracking-tight text-slate-900">
              {VERDICT_LABEL[analysis.verdict ?? "partial_match"]}
            </h2>
            {analysis.verdict_summary && (
              <p className="mt-2.5 text-[14px] leading-[1.7] text-slate-600">
                {analysis.verdict_summary}
              </p>
            )}
            {applyConfig && (
              <div className={cn("mt-4 inline-flex items-start gap-2.5 rounded-xl px-4 py-3 ring-1", applyConfig.tone)}>
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p className="text-[13px] font-semibold">{applyConfig.label}</p>
                  <p className="mt-0.5 text-[12px] opacity-80">{applyConfig.sub}</p>
                  {analysis.apply_reasoning && (
                    <p className="mt-1.5 text-[11.5px] leading-relaxed opacity-70">{analysis.apply_reasoning}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Factor breakdown ── */}
      <section className={sec}>
        <h3 className="text-[17px] font-semibold tracking-tight text-slate-900">Score breakdown</h3>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FactorTile label="Skills" score={analysis.skills_score} />
          <FactorTile label="Experience" score={analysis.experience_score} />
          <FactorTile label="Education" score={analysis.education_score} />
          <FactorTile label="Keywords" score={analysis.keywords_score} />
        </div>
      </section>

      {/* ── Skills ── */}
      {((analysis.matching_skills?.length ?? 0) > 0 ||
        (analysis.missing_skills?.length ?? 0) > 0 ||
        (analysis.bonus_skills?.length ?? 0) > 0) && (
        <section className={sec}>
          <h3 className="text-[17px] font-semibold tracking-tight text-slate-900">Skills analysis</h3>

          <div className="mt-5 space-y-5">
            {(analysis.matching_skills?.length ?? 0) > 0 && (
              <div>
                <p className="mb-2.5 text-[11px] font-semibold text-slate-500">
                  You have · {analysis.matching_skills!.length}
                </p>
                <div className="flex flex-wrap gap-2">
                  {analysis.matching_skills!.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1 text-[12.5px] font-medium text-emerald-700 ring-1 ring-emerald-200/70"
                    >
                      <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(analysis.missing_skills?.length ?? 0) > 0 && (
              <div>
                <p className="mb-2.5 text-[11px] font-semibold text-slate-500">
                  Missing · {analysis.missing_skills!.length}
                </p>
                <div className="flex flex-wrap gap-2">
                  {analysis.missing_skills!.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-orange-50 px-3 py-1 text-[12.5px] font-medium text-orange-600 ring-1 ring-orange-200/70"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(analysis.bonus_skills?.length ?? 0) > 0 && (
              <div>
                <p className="mb-2.5 text-[11px] font-semibold text-slate-500">
                  Bonus · {analysis.bonus_skills!.length}
                </p>
                <div className="flex flex-wrap gap-2">
                  {analysis.bonus_skills!.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-lg bg-slate-50 px-3 py-1 text-[12.5px] font-medium text-slate-500 ring-1 ring-slate-200"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-slate-400">
                  These won&apos;t hurt, but aren&apos;t required.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── ATS Keywords ── */}
      {(missingKws.length > 0 || matchingKws.length > 0) && (
        <section className={sec}>
          <h3 className="text-[17px] font-semibold tracking-tight text-slate-900">ATS keywords</h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">
            Most companies filter resumes automatically. Add missing keywords to pass ATS screening.
          </p>

          {missingKws.length > 0 && (
            <div className="mt-5">
              <p className="mb-2.5 text-[11px] font-semibold text-slate-500">
                Add to your resume · {missingKws.length}
              </p>
              <div className="flex flex-wrap gap-2">
                {missingKws.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1 text-[12.5px] font-medium text-red-700 ring-1 ring-red-200/70"
                  >
                    <X className="h-3 w-3 shrink-0" aria-hidden />
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {matchingKws.length > 0 && (
            <div className="mt-5">
              <p className="mb-2.5 text-[11px] font-semibold text-slate-500">
                Already present · {matchingKws.length}
              </p>
              <div className="flex flex-wrap gap-2">
                {matchingKws.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1 text-[12.5px] font-medium text-emerald-700 ring-1 ring-emerald-200/60"
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Experience ── */}
      {expMatch && (
        <section className={sec}>
          <h3 className="text-[17px] font-semibold tracking-tight text-slate-900">Experience match</h3>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 px-4 py-4 ring-1 ring-slate-200/50">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Required</p>
              <p className="mt-1.5 text-[26px] font-bold leading-none text-slate-800">
                {expMatch.required_years != null ? `${expMatch.required_years}+` : "—"}
              </p>
              <p className="mt-1 text-[12px] text-slate-400">years</p>
            </div>
            <div className={cn(
              "rounded-xl px-4 py-4 ring-1",
              expMatch.candidate_years >= (expMatch.required_years ?? 0)
                ? "bg-emerald-50 ring-emerald-200/60"
                : "bg-amber-50 ring-amber-200/60"
            )}>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">You have</p>
              <p className={cn(
                "mt-1.5 text-[26px] font-bold leading-none",
                expMatch.candidate_years >= (expMatch.required_years ?? 0) ? "text-emerald-700" : "text-amber-700"
              )}>
                {expMatch.candidate_years}
              </p>
              <p className="mt-1 text-[12px] text-slate-400">years</p>
            </div>
          </div>

          {expMatch.matching_roles.length > 0 && (
            <div className="mt-5">
              <p className="mb-2.5 text-[11px] font-semibold text-slate-500">Relevant roles</p>
              <div className="flex flex-wrap gap-2">
                {expMatch.matching_roles.map((role) => (
                  <span key={role} className="rounded-lg bg-emerald-50 px-3 py-1 text-[12.5px] font-medium text-emerald-700 ring-1 ring-emerald-200/60">
                    {role}
                  </span>
                ))}
              </div>
            </div>
          )}

          {expMatch.gaps.length > 0 && (
            <div className="mt-5">
              <p className="mb-2.5 text-[11px] font-semibold text-slate-500">Gaps identified</p>
              <ul className="space-y-1.5">
                {expMatch.gaps.map((gap) => (
                  <li key={gap} className="flex gap-2.5 text-[13.5px] text-slate-600">
                    <span aria-hidden className="mt-[0.55em] h-[5px] w-[5px] shrink-0 rounded-full bg-amber-400" />
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── Recommendations ── */}
      {sortedRecs.length > 0 && (
        <section className={sec}>
          <h3 className="text-[17px] font-semibold tracking-tight text-slate-900">Recommendations</h3>
          <div className="mt-5 space-y-3">
            {sortedRecs.map((rec, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-xl p-4 ring-1",
                  rec.priority === "high"
                    ? "bg-red-50 ring-red-200/60"
                    : rec.priority === "medium"
                      ? "bg-amber-50 ring-amber-200/60"
                      : "bg-slate-50 ring-slate-200/50"
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      rec.priority === "high" ? "bg-red-500" :
                      rec.priority === "medium" ? "bg-amber-500" : "bg-slate-400"
                    )}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "text-[10.5px] font-bold uppercase tracking-[0.1em]",
                      rec.priority === "high" ? "text-red-600" :
                      rec.priority === "medium" ? "text-amber-600" : "text-slate-500"
                    )}
                  >
                    {rec.priority}
                  </span>
                  <span className="text-[10.5px] text-slate-400">·</span>
                  <span className="text-[10.5px] capitalize text-slate-500">{rec.category}</span>
                </div>
                <p className="text-[13.5px] font-semibold text-slate-900">{rec.issue}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{rec.fix}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Actions ── */}
      <div className="border-t border-slate-100 px-6 py-6">
        <div className="flex flex-wrap gap-3">
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-sm transition hover:bg-orange-400"
          >
            Apply now
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <Link
            href={`/dashboard/resume/studio?mode=tailor&jobId=${job.id}`}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Tailor resume
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <Link
            href={`/dashboard/cover-letters/${job.id}`}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Cover letter
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyzePage() {
  const params = useParams<{ jobId: string }>()
  const jobId = params.jobId
  const { primaryResume } = useResumeContext()
  const resumeId = primaryResume?.parse_status === "complete" ? primaryResume.id : null
  const {
    hasAccess: hasAnalysisAccess,
    requiredPlan: analysisRequiredPlan,
    isLoading: accessLoading,
    showUpgradePrompt,
  } = useFeatureAccess("deep_analysis")
  const canRunAnalysis = hasAnalysisAccess && !accessLoading

  const [job, setJob] = useState<JobWithCompany | null>(null)
  const [jobLoading, setJobLoading] = useState(true)

  const { analysis, isLoading, isAnalyzing, error, triggerAnalysis } = useResumeAnalysis(
    canRunAnalysis ? resumeId : null,
    canRunAnalysis ? jobId : null
  )

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" })
      if (!res.ok) { setJob(null); setJobLoading(false); return }
      const body = (await res.json()) as { job: JobWithCompany | null }
      setJob(body.job ?? null)
      setJobLoading(false)
    }
    void load()
  }, [jobId])

  useEffect(() => {
    if (!canRunAnalysis || !resumeId || isLoading || isAnalyzing || analysis || error) return
    void triggerAnalysis()
  }, [canRunAnalysis, resumeId, isLoading, isAnalyzing, analysis, error, triggerAnalysis])

  const analysisBusy = jobLoading || (canRunAnalysis && (isLoading || isAnalyzing))
  const busy = accessLoading || analysisBusy
  const isPlanBlocked = !accessLoading && !hasAnalysisAccess
  const isPlanError = Boolean(error && /requires the .* plan/i.test(error))
  const planName = analysisRequiredPlan ? PLAN_NAMES[analysisRequiredPlan] : "Pro"

  return (
    <main className="min-h-full bg-slate-50 pb-20">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="relative bg-[#0C1222]">
        <div className="pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full bg-orange-600/8 blur-3xl" aria-hidden />
        <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
          <Link
            href={`/dashboard/jobs/${jobId}`}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 transition hover:text-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
            Back to job
          </Link>

          {job && (
            <div className="mt-5 flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5 p-1">
                  <CompanyLogo
                    companyName={job.company.name}
                    domain={job.company.domain ?? null}
                    logoUrl={job.company.logo_url ?? null}
                    className="h-11 w-11 rounded-lg border-0"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11.5px] font-semibold text-slate-400">{job.company.name}</p>
                  <h1 className="text-[18px] font-bold leading-tight text-white">{job.title}</h1>
                </div>
              </div>
              <a
                href={job.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden shrink-0 items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-orange-400 sm:inline-flex"
              >
                Apply
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          )}

          <div className="mt-5 border-t border-white/8 pt-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Resume analysis
            </p>
          </div>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6">

        {/* No resume */}
        {!resumeId && !isLoading && (
          <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-slate-200/60 shadow-sm">
            <p className="text-[17px] font-semibold text-slate-900">Resume not ready</p>
            <p className="mt-2 text-[13.5px] text-slate-500">
              Your resume needs to finish parsing before analysis can run.
            </p>
            <Link
              href="/dashboard/resume"
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-orange-400"
            >
              Go to resume
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        )}

        {/* Loading */}
        {resumeId && analysisBusy && (
          <div className="rounded-2xl bg-white ring-1 ring-slate-200/60 shadow-sm">
            <AnalysisLoader isAnalyzing={isAnalyzing} />
          </div>
        )}

        {/* Plan gate */}
        {!busy && (isPlanBlocked || isPlanError) && (
          <div className="rounded-2xl bg-white px-6 py-8 ring-1 ring-slate-200/60 shadow-sm">
            <p className="text-[17px] font-semibold text-slate-900">Deep analysis is locked</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-slate-500">
              This feature requires the {planName} plan. Upgrade to unlock full resume-to-job analysis.
            </p>
            <button
              type="button"
              onClick={showUpgradePrompt}
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-orange-400"
            >
              Upgrade to {planName}
            </button>
          </div>
        )}

        {/* Error */}
        {!busy && !isPlanError && !isPlanBlocked && error && (
          <div className="rounded-2xl bg-white px-6 py-8 ring-1 ring-red-200/60 shadow-sm">
            <p className="text-[15px] font-semibold text-red-700">Analysis failed</p>
            <p className="mt-1.5 text-[13.5px] text-slate-500">{error}</p>
            <button
              type="button"
              onClick={() => void triggerAnalysis()}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-orange-400"
            >
              Retry
            </button>
          </div>
        )}

        {/* Full analysis */}
        {!busy && !error && analysis && job && (
          <FullAnalysisView analysis={analysis} job={job} />
        )}
      </div>
    </main>
  )
}
