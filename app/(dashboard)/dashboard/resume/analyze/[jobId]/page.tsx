"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  XCircle,
} from "lucide-react"
import AnalysisScoreCircle from "@/components/resume/AnalysisScoreCircle"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import SkillsGapChart from "@/components/resume/SkillsGapChart"
import { PLAN_NAMES } from "@/lib/gates"
import { useFeatureAccess } from "@/lib/hooks/useFeatureAccess"
import { useResumeAnalysis } from "@/lib/hooks/useResumeAnalysis"
import { cn } from "@/lib/utils"
import type { ApplyRecommendation, Company, Job, ResumeAnalysis } from "@/types"

type JobWithCompany = Job & { company: Company }

const VERDICT_LABEL: Record<string, string> = {
  strong_match: "Strong Match",
  good_match: "Good Match",
  partial_match: "Partial Match",
  weak_match: "Weak Match",
}

const APPLY_CONFIG: Record<ApplyRecommendation, { label: string; sub: string; className: string }> = {
  apply_now: {
    label: "Apply now",
    sub: "You're a strong fit for this role.",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  apply_with_tweaks: {
    label: "Apply after updating your resume",
    sub: "A few changes could significantly improve your chances.",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  stretch_role: {
    label: "Stretch role",
    sub: "Apply if you're confident - expect tough questions on the gaps.",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  skip: {
    label: "Consider skipping",
    sub: "Significant gaps exist. Consider building more experience first.",
    className: "border-red-200 bg-red-50 text-red-800",
  },
}

const PRIORITY_STYLES = {
  high: "border-red-200 bg-red-50 text-red-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-gray-200 bg-gray-50 text-gray-600",
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  skills: <CheckCircle2 className="h-4 w-4" />,
  experience: <ChevronRight className="h-4 w-4" />,
  keywords: <Lightbulb className="h-4 w-4" />,
  format: <Lightbulb className="h-4 w-4" />,
}

// Loading steps shown while analysis is running
const STEPS = [
  "Reading your resume…",
  "Analyzing job requirements…",
  "Comparing skills and experience…",
  "Generating recommendations…",
  "Finalizing your match score…",
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
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-8 py-16">
      <div className="space-y-3 w-full max-w-sm">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-3">
            {i < step ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
            ) : i === step ? (
              <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#FF5C18] border-t-transparent" />
            ) : (
              <div className="h-5 w-5 shrink-0 rounded-full border-2 border-gray-200" />
            )}
            <span
              className={cn(
                "text-sm",
                i < step && "text-emerald-600",
                i === step && "font-semibold text-[#FF5C18]",
                i > step && "text-gray-400"
              )}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400">This usually takes 5–15 seconds</p>
    </div>
  )
}

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  const value = score ?? 0
  const color = value >= 70 ? "bg-emerald-500" : value >= 40 ? "bg-amber-400" : "bg-red-400"
  return (
    <div className="rounded-2xl border border-gray-200 bg-[#FAFCFF] px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
        <div className={cn("h-full rounded-full transition-all duration-700", color)} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function FullAnalysisView({ analysis, job }: { analysis: ResumeAnalysis; job: JobWithCompany }) {
  const applyConfig = analysis.apply_recommendation
    ? APPLY_CONFIG[analysis.apply_recommendation]
    : null

  const sortedDensity = Object.entries(analysis.keyword_density ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)

  const sortedRecs = [...(analysis.recommendations ?? [])].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.priority] - order[b.priority]
  })

  const expMatch = analysis.experience_match

  return (
    <div className="space-y-6">
      {/* Overall score + verdict */}
      <div className="surface-card p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <AnalysisScoreCircle score={analysis.overall_score ?? 0} size="lg" />
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              Overall match
            </p>
            <p className="mt-1 text-3xl font-semibold text-gray-900">
              {VERDICT_LABEL[analysis.verdict ?? "partial_match"]}
            </p>
            {analysis.verdict_summary && (
              <p className="mt-3 text-sm leading-7 text-gray-600">{analysis.verdict_summary}</p>
            )}
          </div>
          {applyConfig && (
            <div className={cn("rounded-2xl border px-5 py-4 lg:max-w-xs", applyConfig.className)}>
              <p className="text-sm font-semibold">{applyConfig.label}</p>
              <p className="mt-1 text-xs opacity-80">{applyConfig.sub}</p>
              {analysis.apply_reasoning && (
                <p className="mt-2 text-xs leading-5 opacity-70">{analysis.apply_reasoning}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Score breakdown */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ScoreBar label="Skills" score={analysis.skills_score} />
        <ScoreBar label="Experience" score={analysis.experience_score} />
        <ScoreBar label="Education" score={analysis.education_score} />
        <ScoreBar label="Keywords" score={analysis.keywords_score} />
      </div>

      {/* Skills gap */}
      <section className="surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-gray-400">
          Skills analysis
        </h2>
        <SkillsGapChart
          matching={analysis.matching_skills ?? []}
          missing={analysis.missing_skills ?? []}
          bonus={analysis.bonus_skills ?? []}
        />
      </section>

      {/* Keywords */}
      <section className="surface-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-gray-400">
          ATS keyword analysis
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          Most companies filter resumes automatically before a human sees them. These keywords appear in the job description but may be missing from your resume.
        </p>

        {(analysis.missing_keywords ?? []).length > 0 && (
          <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-xs font-semibold text-orange-800 mb-3">
              Add these to pass ATS screening:
            </p>
            <div className="flex flex-wrap gap-2">
              {(analysis.missing_keywords ?? []).slice(0, 5).map((kw) => {
                const count = analysis.keyword_density?.[kw]
                return (
                  <span key={kw} className="inline-flex items-center gap-1.5 rounded-full border border-orange-300 bg-white px-3 py-1.5 text-xs font-medium text-orange-800">
                    {kw}
                    {count != null && <span className="opacity-60">×{count}</span>}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {/* Missing */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
              Missing ({(analysis.missing_keywords ?? []).length})
            </p>
            <div className="flex flex-wrap gap-2">
              {sortedDensity
                .filter(([kw]) => analysis.missing_keywords?.includes(kw))
                .map(([kw, count]) => (
                  <span key={kw} className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
                    <XCircle className="h-3 w-3" />
                    {kw}
                    <span className="opacity-60">×{count}</span>
                  </span>
                ))}
              {(analysis.missing_keywords ?? [])
                .filter((kw) => !sortedDensity.find(([k]) => k === kw))
                .map((kw) => (
                  <span key={kw} className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
                    <XCircle className="h-3 w-3" />
                    {kw}
                  </span>
                ))}
            </div>
          </div>
          {/* Present */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
              Present ({(analysis.matching_keywords ?? []).length})
            </p>
            <div className="flex flex-wrap gap-2">
              {(analysis.matching_keywords ?? []).map((kw) => (
                <span key={kw} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  {kw}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Experience gap */}
      {expMatch && (
        <section className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-gray-400">
            Experience match
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-[#FAFCFF] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                Years required
              </p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {expMatch.required_years != null ? `${expMatch.required_years}+` : "Not specified"}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-[#FAFCFF] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                Your experience
              </p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {expMatch.candidate_years} years
              </p>
            </div>
          </div>
          {expMatch.matching_roles.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400 mb-2">
                Relevant roles
              </p>
              <div className="flex flex-wrap gap-2">
                {expMatch.matching_roles.map((role) => (
                  <span key={role} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                    {role}
                  </span>
                ))}
              </div>
            </div>
          )}
          {expMatch.gaps.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400 mb-2">
                Experience gaps
              </p>
              <div className="space-y-1">
                {expMatch.gaps.map((gap) => (
                  <p key={gap} className="text-sm text-gray-600">- {gap}</p>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Recommendations */}
      {sortedRecs.length > 0 && (
        <section className="surface-card p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-gray-400">
            Recommendations
          </h2>
          <div className="space-y-3">
            {sortedRecs.map((rec, i) => (
              <div key={i} className="rounded-2xl border border-gray-200 bg-[#FAFCFF] p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]", PRIORITY_STYLES[rec.priority])}>
                    {rec.priority}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[10px] font-medium text-gray-500 capitalize">
                    {CATEGORY_ICONS[rec.category]}
                    {rec.category}
                  </span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{rec.issue}</p>
                <p className="mt-1 text-sm leading-6 text-gray-600">{rec.fix}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 pb-10">
        <a
          href={job.apply_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-2xl bg-[#FF5C18] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
        >
          Apply directly
          <ExternalLink className="h-4 w-4" />
        </a>
        <Link
          href={`/dashboard/resume/studio?mode=tailor&jobId=${job.id}`}
          className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Edit resume
        </Link>
        <Link
          href={`/dashboard/cover-letter/${job.id}`}
          className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Generate cover letter
        </Link>
      </div>
    </div>
  )
}

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

  // Fetch job details
  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" })
      if (!res.ok) {
        setJob(null)
        setJobLoading(false)
        return
      }
      const body = (await res.json()) as { job: JobWithCompany | null }
      setJob(body.job ?? null)
      setJobLoading(false)
    }
    void load()
  }, [jobId])

  // Trigger analysis if none exists
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
    <main className="app-page">
      <div className="app-shell max-w-6xl space-y-5 pb-8">
        {/* Back */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to feed
        </Link>

        {/* Job header */}
        {job && (
          <div className="surface-hero px-6 py-4 sm:px-8 sm:py-6 lg:px-10">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex min-w-0 items-center gap-4">
                {job.company.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={job.company.logo_url}
                    alt={job.company.name}
                    className="h-14 w-14 rounded-2xl border border-gray-200 object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF1E8] text-xl font-bold text-[#ea580c]">
                    {job.company.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                    {job.company.name}
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold leading-tight text-gray-900">
                    {job.title}
                  </h1>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {job.is_remote && (
                      <span className="rounded-full border border-[#FFD2B8] bg-[#FFF7F2] px-2.5 py-1 text-xs font-medium text-[#9A3412]">
                        Remote
                      </span>
                    )}
                    {job.sponsors_h1b && (
                      <span className="rounded-full border border-[#FFD2B8] bg-[#FFF7F2] px-2.5 py-1 text-xs font-semibold text-[#9A3412]">
                        Sponsors H1B
                      </span>
                    )}
                    {job.seniority_level && (
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 capitalize">
                        {job.seniority_level}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <a
                href={job.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5C18] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E] sm:w-auto sm:justify-self-end sm:self-center"
              >
                Apply
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        )}

        {/* No resume state */}
        {!resumeId && !isLoading && (
          <div className="surface-card px-6 py-8 text-center sm:px-8 sm:py-9">
            <p className="text-lg font-semibold text-gray-900">Resume not ready</p>
            <p className="mt-2 text-sm text-gray-500">
              Your resume needs to finish parsing before analysis can run.
            </p>
            <Link
              href="/dashboard/resume"
              className="mt-5 inline-flex rounded-2xl bg-[#FF5C18] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
            >
              Go to resume page
            </Link>
          </div>
        )}

        {/* Loading state */}
        {resumeId && analysisBusy && <AnalysisLoader isAnalyzing={isAnalyzing} />}

        {/* Plan gate */}
        {!busy && (isPlanBlocked || isPlanError) && (
          <div className="rounded-[28px] border border-[#FFD2B8] bg-[#FFF7F2] px-4 py-4 sm:px-5 sm:py-5">
            <p className="text-xl font-semibold text-[#9A3412]">Deep analysis is locked</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#C2410C]">
              This feature requires the {planName} plan. Upgrade to unlock full resume-to-job
              analysis.
            </p>
            <button
              type="button"
              onClick={showUpgradePrompt}
              className="mt-4 rounded-2xl bg-[#FF5C18] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
            >
              Upgrade to {planName}
            </button>
          </div>
        )}

        {/* Error */}
        {!busy && !isPlanError && !isPlanBlocked && error && (
          <div className="rounded-[28px] border border-red-200 bg-white px-4 py-4 sm:px-5 sm:py-5">
            <p className="font-semibold text-red-700">Analysis failed</p>
            <p className="mt-1 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => void triggerAnalysis()}
              className="mt-4 rounded-2xl bg-[#FF5C18] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
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
