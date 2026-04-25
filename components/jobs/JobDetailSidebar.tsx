"use client"

import { useEffect, useId, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle2, Info } from "lucide-react"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useResumeAnalysis } from "@/lib/hooks/useResumeAnalysis"
import type { JobMatchScore } from "@/types"

type Props = {
  jobId: string
  /**
   * Pre-resolved on the job page (same as GET /api/match/score) so the gauge can render
   * on first paint without waiting for resume context + a second client round-trip.
   */
  initialMatchScore?: JobMatchScore | null
}

function clamp(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function MatchGauge({ value }: { value: number | null }) {
  const gradId = useId().replace(/:/g, "")
  const size = 168
  const stroke = 14
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2

  // Half-donut: arc spans 180° (semicircle), starting at 9 o'clock.
  const arcLength = Math.PI * r
  const pct = value == null ? 0 : clamp(value)
  const dash = (pct / 100) * arcLength

  return (
    <div className="relative mx-auto" style={{ width: size, height: size / 2 + 8 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
        className="absolute inset-x-0 top-0"
      >
        <defs>
          <linearGradient id={`match-grad-${gradId}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>
        </defs>
        {/* Track */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* Progress */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={`url(#match-grad-${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${arcLength}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-[42%] flex flex-col items-center text-center">
        <span className="text-[34px] font-bold leading-none tracking-tight text-emerald-600 tabular-nums">
          {value == null ? "—" : `${pct}%`}
        </span>
      </div>
    </div>
  )
}

function verdictLabel(score: number | null): string {
  if (score == null) return "Upload your resume"
  if (score >= 85) return "Great match!"
  if (score >= 70) return "Good match"
  if (score >= 50) return "Partial match"
  return "Low match"
}

function FactorRow({ label, description, value }: { label: string; description: string; value: number | null }) {
  const pct = value == null ? null : clamp(value)
  return (
    <li className="flex items-start gap-3">
      <CheckCircle2
        className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${pct == null ? "text-slate-300" : "text-emerald-500"}`}
        strokeWidth={2}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold text-slate-900">{label}</span>
          <span className="shrink-0 text-[13px] font-semibold text-slate-700 tabular-nums">
            {pct == null ? "—" : `${pct}%`}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{description}</p>
      </div>
    </li>
  )
}

export default function JobDetailSidebar({ jobId, initialMatchScore }: Props) {
  const { primaryResume } = useResumeContext()
  const resumeId = primaryResume?.parse_status === "complete" ? primaryResume.id : null
  const hasServerMatchScore = initialMatchScore !== undefined
  const [fastScore, setFastScore] = useState<JobMatchScore | null>(initialMatchScore ?? null)
  const { analysis } = useResumeAnalysis(resumeId, jobId)

  useEffect(() => {
    if (!hasServerMatchScore) return
    setFastScore(initialMatchScore ?? null)
  }, [hasServerMatchScore, jobId, initialMatchScore])

  useEffect(() => {
    if (hasServerMatchScore) return
    if (!resumeId) {
      setFastScore(null)
      return
    }
    let cancelled = false
    fetch(`/api/match/score?jobId=${jobId}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { score?: JobMatchScore | null }).score ?? null : null))
      .then((s) => {
        if (!cancelled) setFastScore(s)
      })
      .catch(() => {
        if (!cancelled) setFastScore(null)
      })
    return () => {
      cancelled = true
    }
  }, [hasServerMatchScore, jobId, resumeId])

  const overall = analysis?.overall_score ?? fastScore?.overall_score ?? null
  const hasDeepRoleFit = analysis?.keywords_score != null

  const factors = useMemo(() => {
    return [
      {
        label: "Skills match",
        description: "Your top skills align strongly with this job.",
        value: analysis?.skills_score ?? fastScore?.skills_score ?? null,
      },
      {
        label: "Experience",
        description: "Your experience level matches what they're looking for.",
        value: analysis?.experience_score ?? fastScore?.seniority_score ?? null,
      },
      {
        label: "Education",
        description: "Your education matches the job requirements.",
        value: analysis?.education_score ?? null,
      },
      {
        label: "Location",
        description: "You meet the location preference.",
        value: fastScore?.location_score ?? null,
      },
      {
        label: hasDeepRoleFit ? "Job role fit" : "Authorization fit",
        description: hasDeepRoleFit
          ? "Your profile keywords align with this role."
          : "This reflects sponsorship and work authorization compatibility.",
        value: hasDeepRoleFit ? (analysis?.keywords_score ?? null) : (fastScore?.sponsorship_score ?? null),
      },
    ]
  }, [analysis, fastScore, hasDeepRoleFit])

  return (
    <aside className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
      <div className="flex items-center gap-1.5">
        <h2 className="text-[15px] font-semibold text-slate-900">Match Score</h2>
        <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      </div>

      <div className="mt-4">
        <MatchGauge value={overall} />
        <p className="mt-1 text-center text-sm font-medium text-slate-700">{verdictLabel(overall)}</p>
      </div>

      <div className="mt-5">
        <h3 className="text-[13px] font-semibold text-slate-900">Why this is a great match</h3>
        <ul className="mt-3 space-y-3">
          {factors.map((factor) => (
            <FactorRow key={factor.label} {...factor} />
          ))}
        </ul>
      </div>

      {resumeId ? (
        <Link
          href={`/dashboard/resume/analyze/${jobId}`}
          className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#2563EB] hover:underline"
        >
          View full match details
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : (
        <Link
          href="/dashboard/resume"
          className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#2563EB] hover:underline"
        >
          Upload resume to score
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </aside>
  )
}
