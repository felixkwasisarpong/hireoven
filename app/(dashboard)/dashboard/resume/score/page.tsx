"use client"

import { useMemo } from "react"
import Link from "next/link"
import {
  AlertCircle,
  AlignLeft,
  ArrowRight,
  BarChart2,
  BrainCircuit,
  CheckCircle2,
  Eye,
  FileSearch,
  Gauge,
  Globe2,
  Layers,
  Lightbulb,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Zap,
} from "lucide-react"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { buildResumeScoreBreakdown as buildDetailedResumeScoreBreakdown } from "@/lib/resume/hub"
import { buildResumeScoreBreakdown } from "@/lib/resume/scoring"
import { cn } from "@/lib/utils"
import type { Resume } from "@/types"
import type { ResumeScoreBreakdown, ResumeScoreCategory } from "@/types/resume-hub"

// ─── Score helpers ────────────────────────────────────────────────────────────

function getScoreTone(score: number) {
  if (score >= 80) return { ring: "#10B981", bar: "bg-emerald-500", text: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" }
  if (score >= 60) return { ring: "#3B82F6", bar: "bg-blue-500",    text: "text-blue-600",   bg: "bg-blue-50",   border: "border-blue-200"   }
  if (score >= 40) return { ring: "#F59E0B", bar: "bg-amber-500",   text: "text-amber-600",  bg: "bg-amber-50",  border: "border-amber-200"  }
  return           { ring: "#EF4444",        bar: "bg-red-500",     text: "text-red-600",    bg: "bg-red-50",    border: "border-red-200"    }
}

function getScoreLabel(score: number) {
  if (score >= 80) return "Excellent"
  if (score >= 60) return "Very Good"
  if (score >= 40) return "Fair"
  return "Needs work"
}

function getPriorityLabel(score: number): "High" | "Medium" | "Low" {
  if (score < 60) return "High"
  if (score < 80) return "Medium"
  return "Low"
}

// ─── Build score breakdown ────────────────────────────────────────────────────

function buildExtendedBreakdown(resume: Resume): ResumeScoreBreakdown {
  const base = buildResumeScoreBreakdown(resume)
  const detailed = buildDetailedResumeScoreBreakdown(resume)

  const existing: ResumeScoreCategory[] = [
    {
      key: "ats_readability", label: "ATS Readability",
      score: detailed.atsReadability,
      explanation: "Measures parse quality, contact info, standard sections, readable text, skills clarity, role targeting, and measurable bullets.",
      suggestion: "Use a simple PDF/DOCX with clear headings, contact info, skills, experience bullets, and measurable impact.",
      weight: 15, icon: "FileSearch",
    },
    {
      key: "keyword_coverage", label: "Keyword Coverage",
      score: detailed.keywordCoverage,
      explanation: "Keyword density is measured across your skills and experience sections.",
      suggestion: "Use the Tailor to Job tool to add missing keywords for your target role.",
      weight: 15, icon: "BrainCircuit",
    },
    {
      key: "achievements", label: "Impact Metrics",
      score: Math.round((base.achievements / 25) * 100),
      explanation: "Strong use of metrics and quantified achievements signals high impact.",
      suggestion: "Add numbers: revenue, time saved, users served, error rates reduced.",
      weight: 15, icon: "TrendingUp",
    },
    {
      key: "completeness", label: "Formatting Quality",
      score: detailed.formattingQuality,
      explanation: "Resume sections are complete and well-structured for readability.",
      suggestion: "Ensure summary, experience, education, and skills sections are all present.",
      weight: 15, icon: "Layers",
    },
    {
      key: "role_alignment", label: "Role Alignment",
      score: detailed.roleAlignment,
      explanation: resume.primary_role ? `Primary role detected as "${resume.primary_role}".` : "No clear role detected.",
      suggestion: "Make sure your target role appears in your summary, most recent title, and bullets.",
      weight: 15, icon: "Target",
    },
    {
      key: "skills", label: "Technical Depth",
      score: Math.round((base.skillsClarity / 20) * 100),
      explanation: "Skills section demonstrates technical breadth and domain depth.",
      suggestion: "List your strongest 8–12 technical skills clearly. Remove soft-skill filler.",
      weight: 10, icon: "Zap",
    },
    {
      key: "summary", label: "Recruiter Readability",
      score: detailed.recruiterReadability,
      explanation: "Summary and bullets are scannable and easy for recruiters to read quickly.",
      suggestion: "Write a 3–4 sentence summary: role, level, key strength, what you offer.",
      weight: 15, icon: "Eye",
    },
  ]

  const overall = Math.round(
    existing.reduce((sum, c) => sum + c.score * (c.weight / 100), 0)
  )

  return { overall, categories: existing }
}

// ─── Score ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const tone = getScoreTone(score)
  const label = getScoreLabel(score)
  const circ = 2 * Math.PI * 54

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className="relative flex h-40 w-40 items-center justify-center rounded-full bg-white">
        <svg className="absolute inset-0 -rotate-90" width="160" height="160" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r="54" fill="none" stroke="#E9EEF6" strokeWidth="12" />
          <circle
            cx="80"
            cy="80"
            r="54"
            fill="none"
            stroke={tone.ring}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * circ} ${circ}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <div className="flex flex-col items-center">
          <span className="text-[38px] font-bold leading-none tracking-tight text-slate-950 tabular-nums">{score}</span>
          <span className="mt-1 text-[11px] font-semibold text-slate-400">/100</span>
        </div>
      </div>
      <div className="text-center">
        <p className={cn("text-sm font-semibold", tone.text)}>{label}</p>
        <p className="mt-1 max-w-[190px] text-[12.5px] leading-relaxed text-slate-500">
          Your resume is strong. A few improvements can make it excellent.
        </p>
      </div>
    </div>
  )
}

// ─── Score bar row ────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Layers, TrendingUp, Zap, AlignLeft, Eye, FileSearch, Target, BrainCircuit, BarChart2,
}

function ScoreBar({ category }: { category: ResumeScoreCategory }) {
  const tone = getScoreTone(category.score)

  return (
    <div className="grid grid-cols-[150px_1fr_56px] items-center gap-3">
      <p className="truncate text-[13px] font-medium text-slate-700">{category.label}</p>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all duration-700", tone.bar)}
          style={{ width: `${category.score}%` }}
        />
      </div>
      <span className="text-right text-[12.5px] font-semibold text-slate-700 tabular-nums">
        {category.score}/100
      </span>
    </div>
  )
}

// ─── Priority fix card ────────────────────────────────────────────────────────

function PriorityFix({
  category,
  rank,
}: {
  category: ResumeScoreCategory
  rank: number
}) {
  const priority = getPriorityLabel(category.score)
  const Icon = ICON_MAP[category.icon] ?? Lightbulb
  const priorityColors = {
    High: "bg-red-50 text-red-600",
    Medium: "bg-amber-50 text-amber-600",
    Low: "bg-emerald-50 text-emerald-600",
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-[#5B4DFF]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13.5px] font-semibold text-slate-900">{category.suggestion}</p>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", priorityColors[priority])}>
              {priority}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-slate-500">Priority fix #{rank} · {category.label}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Detailed insight card ────────────────────────────────────────────────────

function DetailedInsight({ resume, category }: { resume: Resume; category: ResumeScoreCategory }) {
  void resume
  const tone = getScoreTone(category.score)
  const Icon = ICON_MAP[category.icon] ?? BarChart2

  const missingKeywords = category.key === "keyword_coverage"
    ? ["Kubernetes", "Microservices", "Docker", "System Design", "Observability"]
    : []

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone.bg, tone.text)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{category.label}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{category.explanation}</p>
            </div>
            <span className="shrink-0 text-[13px] font-semibold text-slate-700 tabular-nums">{category.score}/100</span>
          </div>
        </div>
      </div>

      {missingKeywords.length > 0 && (
        <div className="mt-5 space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Missing Keywords
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missingKeywords.map((kw) => (
              <span key={kw} className="rounded-full bg-red-50 px-2.5 py-1 text-[12px] font-medium text-red-600">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_220px] md:items-center">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Recommended Fix
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-slate-600">{category.suggestion}</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#5B4DFF] px-3.5 py-2.5 text-[12.5px] font-semibold text-white transition hover:bg-[#493EE6]"
        >
          <Sparkles className="h-3 w-3" />
          Auto-Fix Preview
        </button>
      </div>
    </div>
  )
}

// ─── International add-on ─────────────────────────────────────────────────────

function InternationalPanel({ resume }: { resume: Resume }) {
  const isSTEM = (resume.top_skills ?? []).some((s) =>
    /python|java|machine learning|data|engineer|science|math|statistics/i.test(s)
  )
  const checks = [
    {
      ok: !/(visa|h-?1b|opt|f-?1|citizenship|authorization)/i.test(resume.raw_text ?? ""),
      label: "No unnecessary immigration details in resume body",
    },
    { ok: isSTEM, label: "STEM/technical keyword emphasis looks strong" },
    { ok: Boolean(resume.summary), label: "Professional summary is present" },
  ]

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <Globe2 className="h-4 w-4 text-[#5B4DFF]" />
            <p className="text-[11px] font-semibold text-slate-900">International Student Insights</p>
          </div>
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-slate-500">
            Resume guidance only. Confirm immigration documentation questions with your DSO or attorney.
          </p>
        </div>
        <Link href="/dashboard/resume/studio?mode=tailor" className="shrink-0 text-[12px] font-semibold text-[#5B4DFF] hover:underline">
          Learn more
        </Link>
      </div>
      <div className="mt-4 grid gap-2.5 md:grid-cols-3">
        {checks.map(({ ok, label }) => (
          <div key={label} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
            {ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" />
            )}
            <p className="text-[12.5px] font-medium text-slate-700">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function NoResumeState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
        <Gauge className="h-6 w-6" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-slate-800">No resume to score</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
        Upload a resume to get a full score breakdown with actionable improvements.
      </p>
      <Link
        href="/dashboard/resume"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#5B4DFF] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#493EE6]"
      >
        <Upload className="h-4 w-4" />
        Upload resume
      </Link>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResumeScorePage() {
  const { primaryResume, hasResume, isLoading } = useResumeContext()

  const breakdown = useMemo<ResumeScoreBreakdown | null>(() => {
    if (!primaryResume || primaryResume.parse_status !== "complete") return null
    return buildExtendedBreakdown(primaryResume)
  }, [primaryResume])

  const priorityFixes = useMemo(() => {
    if (!breakdown) return []
    return [...breakdown.categories]
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
  }, [breakdown])

  return (
    <main className="min-h-[calc(100vh-8.5rem)] bg-[#FAFBFF]">
      <div className="w-full max-w-none space-y-3 px-4 py-3 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Resume Score Breakdown</h1>
            <p className="mt-1 text-sm text-slate-500">Detailed analysis of your resume and actionable recommendations.</p>
          </div>
          <Link
            href="/dashboard/resume/studio?mode=preview"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B4DFF] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#493EE6]"
          >
            <Sparkles className="h-4 w-4" />
            Fix with AI
          </Link>
        </div>

        {isLoading && (
          <div className="grid gap-5 lg:grid-cols-[260px_1fr_320px]">
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        )}

        {!isLoading && !hasResume && <NoResumeState />}

        {!isLoading && primaryResume && primaryResume.parse_status !== "complete" && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Your resume is still being parsed. Score breakdown will be available once parsing completes.
          </div>
        )}

        {!isLoading && breakdown && primaryResume && (
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-[240px_1fr_300px]">
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">Overall Score</p>
                <div className="mt-4">
                  <ScoreRing score={breakdown.overall} />
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">Score Breakdown</p>
                  <span className="text-[12px] font-medium text-slate-400">7 categories</span>
                </div>
                <div className="space-y-2.5">
                  {breakdown.categories.map((cat) => (
                    <ScoreBar key={cat.key} category={cat} />
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">Top Priority Fixes</p>
                  <Link href="#detailed-insights" className="text-[12px] font-semibold text-[#5B4DFF] hover:underline">
                    View All
                  </Link>
                </div>
                <div className="space-y-3">
                  {priorityFixes.map((fix, i) => (
                    <PriorityFix key={fix.key} category={fix} rank={i + 1} />
                  ))}
                </div>
              </section>
            </div>

            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{primaryResume.name ?? primaryResume.file_name}</p>
                  <p className="mt-0.5 text-[12.5px] text-slate-500">{primaryResume.primary_role ?? "Role not detected"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/dashboard/resume" className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-slate-700 transition hover:bg-slate-50">
                  Switch resume
                </Link>
                <Link href="/dashboard/resume/studio?mode=preview" className="inline-flex items-center justify-center rounded-xl bg-[#5B4DFF] px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#493EE6]">
                  Improve with AI
                </Link>
              </div>
            </div>

            <section id="detailed-insights" className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Detailed Insights</h2>
                  <p className="mt-1 text-[13px] text-slate-500">Prioritized suggestions based on structure, keywords, and role alignment.</p>
                </div>
                <Link href="/dashboard/resume/studio?mode=preview" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#5B4DFF] hover:underline">
                  View all recommendations
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="grid max-h-[calc(100vh-34rem)] min-h-[160px] gap-3 overflow-y-auto lg:grid-cols-2">
                {breakdown.categories
                  .filter((c) => c.score < 88)
                  .slice(0, 4)
                  .map((cat) => (
                    <DetailedInsight key={cat.key} resume={primaryResume} category={cat} />
                  ))}
              </div>
            </section>

            <InternationalPanel resume={primaryResume} />

            <div className="grid gap-2.5 sm:grid-cols-3">
              {[
                { href: "/dashboard/resume/studio?mode=preview", label: "Preview resume", icon: Sparkles },
                { href: "/dashboard/resume/studio?mode=tailor", label: "Tailor to a job", icon: Target },
                { href: "/dashboard/resume/studio?mode=preview", label: "Build new preview", icon: Zap },
              ].map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  {label}
                  <Icon className="h-4 w-4 text-[#5B4DFF]" />
                </Link>
              ))}
            </div>

            <p className="text-center text-[11.5px] text-slate-400">
              Scores are AI-generated guidance based on resume structure, readability, and role alignment.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
