"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Bookmark, ExternalLink, ShieldCheck, Sparkles } from "lucide-react"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useResumeAnalysis } from "@/lib/hooks/useResumeAnalysis"
import type { JobMatchScore } from "@/types"

type Props = {
  jobId: string
  companyName: string
  applyUrl: string
  salaryLabel: string | null
  sponsorsH1b: boolean | null
  sponsorshipScore: number | null
  skills: string[]
  highlights?: string[]
  companySummary?: string | null
}

function scoreTone(value: number | null) {
  if (value == null) return "#94A3B8"
  const safeValue = Math.max(0, Math.min(100, value))
  if (safeValue >= 85) return "#16A34A"
  if (safeValue >= 70) return "#7C3AED"
  if (safeValue >= 50) return "#F59E0B"
  return "#EF4444"
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "")
  if (normalized.length !== 6) return hex
  const bigint = Number.parseInt(normalized, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function scoreVerdict(overallScore: number | null, verdict: string | null | undefined) {
  if (verdict === "strong_match") return "Strong Match"
  if (verdict === "good_match") return "Good Match"
  if (verdict === "partial_match") return "Partial Match"
  if (verdict === "weak_match") return "Low Match"
  if (overallScore == null) return "Match data unavailable"
  if (overallScore >= 85) return "Strong Match"
  if (overallScore >= 70) return "Good Match"
  if (overallScore >= 50) return "Partial Match"
  return "Low Match"
}

function ScoreRing({ value }: { value: number | null }) {
  const safeValue = Math.max(0, Math.min(100, value ?? 0))
  const angle = safeValue * 3.6
  const tone = scoreTone(value)

  return (
    <div className="flex items-center justify-center">
      <div
        className="relative flex h-28 w-28 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(${tone} ${angle}deg, #E3E8F3 ${angle}deg 360deg)`,
          boxShadow: `0 0 0 1px ${hexToRgba(tone, 0.12)}, 0 10px 24px ${hexToRgba(tone, 0.12)}`,
        }}
      >
        <div className="flex h-[90px] w-[90px] flex-col items-center justify-center rounded-full bg-white">
          <span className="text-[2rem] font-semibold text-strong">{value ?? "--"}</span>
          <span className="text-[11px] font-medium text-muted-foreground">
            {value == null ? "No data" : "%"}
          </span>
        </div>
      </div>
    </div>
  )
}

function BreakdownRow({ label, value }: { label: string; value: number | null }) {
  const safeValue = Math.max(0, Math.min(100, value ?? 0))
  const tone = scoreTone(value)
  const track = value == null ? "#CFD6E4" : hexToRgba(tone, 0.2)
  const fill =
    value == null
      ? "#B4BFD4"
      : `linear-gradient(90deg, ${hexToRgba(tone, 0.95)} 0%, ${hexToRgba(tone, 0.72)} 100%)`

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-[#4A5B82]">{label}</span>
        <span className="font-semibold text-strong">{value == null ? "N/A" : `${safeValue}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: track }}>
        {value == null ? (
          <div className="h-full w-full rounded-full" style={{ backgroundColor: fill }} />
        ) : (
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${safeValue}%`, background: fill }}
          />
        )}
      </div>
    </div>
  )
}

function parseSalaryRange(label: string | null) {
  if (!label) return null
  const match = label.match(/([0-9]{2,3})k[^0-9]+([0-9]{2,3})k/i)
  if (!match) return null
  const min = Number.parseInt(match[1], 10)
  const max = Number.parseInt(match[2], 10)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  const median = Math.round((min + max) / 2)
  return { min, max, median }
}

function SidebarCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="surface-panel rounded-lg p-5">
      <h2 className="text-base font-semibold text-strong">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function JobDetailSidebar({
  jobId,
  companyName,
  applyUrl,
  salaryLabel,
  sponsorsH1b,
  sponsorshipScore,
  skills,
  highlights = [],
  companySummary,
}: Props) {
  const { primaryResume } = useResumeContext()
  const resumeId = primaryResume?.parse_status === "complete" ? primaryResume.id : null
  const [fastScore, setFastScore] = useState<JobMatchScore | null>(null)
  const [isScoreLoading, setIsScoreLoading] = useState(false)
  const { analysis, isLoading: isAnalysisLoading } = useResumeAnalysis(resumeId, jobId)

  useEffect(() => {
    if (!resumeId) {
      setFastScore(null)
      return
    }

    let cancelled = false
    setIsScoreLoading(true)

    fetch(`/api/match/score?jobId=${jobId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null
        const payload = (await response.json()) as { score?: JobMatchScore | null }
        return payload.score ?? null
      })
      .then((score) => {
        if (!cancelled) setFastScore(score)
      })
      .catch(() => {
        if (!cancelled) setFastScore(null)
      })
      .finally(() => {
        if (!cancelled) setIsScoreLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [jobId, resumeId])

  const overallScore = analysis?.overall_score ?? fastScore?.overall_score ?? null
  const verdictLabel = scoreVerdict(overallScore, analysis?.verdict)
  const verdictColor = scoreTone(overallScore)
  const breakdownSourceLabel = analysis
    ? "Detailed breakdown from resume analysis"
    : "Instant breakdown from profile compatibility"
  const breakdown = useMemo(
    () =>
      analysis
        ? [
            { label: "Skills", value: analysis.skills_score },
            { label: "Experience", value: analysis.experience_score },
            { label: "Education", value: analysis.education_score },
            { label: "Keywords", value: analysis.keywords_score },
          ]
        : [
            { label: "Skills", value: fastScore?.skills_score ?? null },
            { label: "Seniority", value: fastScore?.seniority_score ?? null },
            { label: "Location", value: fastScore?.location_score ?? null },
            { label: "Sponsorship", value: fastScore?.sponsorship_score ?? null },
          ],
    [analysis, fastScore]
  )

  const matchingSkills = (analysis?.matching_skills ?? []).slice(0, 6)
  const visibleSkills = (matchingSkills.length > 0 ? matchingSkills : skills).slice(0, 6)
  const sponsorshipTone =
    sponsorsH1b || (sponsorshipScore ?? 0) >= 70
      ? "text-emerald-700"
      : (sponsorshipScore ?? 0) >= 50
        ? "text-amber-700"
        : "text-slate-600"
  const sponsorshipLabel =
    sponsorsH1b || (sponsorshipScore ?? 0) >= 70
      ? "High success rate"
      : (sponsorshipScore ?? 0) >= 50
        ? "Moderate sponsorship signal"
        : "Limited sponsorship signal"
  const salaryRange = parseSalaryRange(salaryLabel)

  return (
    <aside className="space-y-4">
      <SidebarCard title="Your Match">
        {!resumeId ? (
          <div className="space-y-4">
            <ScoreRing value={null} />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Upload your resume to see how well you match this role and where to improve.
            </p>
            <Link
              href="/dashboard/resume"
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-hover"
            >
              Upload resume to score match
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <ScoreRing value={isScoreLoading && !overallScore ? null : overallScore} />
            <div className="rounded-xl border border-[#E4E8F4] bg-[#F9FBFF] px-3 py-2 text-center">
              <p className="text-base font-semibold" style={{ color: verdictColor }}>
                {verdictLabel}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{breakdownSourceLabel}</p>
            </div>
            <div className="space-y-2.5">
              {breakdown.map((item) => (
                <BreakdownRow key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
            <Link
              href={`/dashboard/resume/analyze/${jobId}`}
              className="inline-flex items-center gap-2 rounded-full border border-[#E7D9FF] bg-[#F4ECFF] px-3 py-1.5 text-sm font-semibold text-[#6D3FF8] transition-colors hover:bg-[#ECE0FF]"
            >
              <Sparkles className="h-4 w-4" />
              {analysis || isAnalysisLoading ? "Open full analysis" : "Improve match score"}
            </Link>
          </div>
        )}
      </SidebarCard>

      {salaryLabel ? (
        <SidebarCard title="Salary Range">
          <p className="text-3xl font-semibold text-strong">{salaryLabel} /yr</p>
          <p className="mt-1 text-sm text-muted-foreground">Total compensation</p>
          {salaryRange ? (
            <div className="mt-4 space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-300 via-blue-500 to-blue-300"
                  style={{ width: "100%" }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>${salaryRange.min}K</span>
                <span>${salaryRange.median}K median</span>
                <span>${salaryRange.max}K</span>
              </div>
            </div>
          ) : null}
        </SidebarCard>
      ) : null}

      <SidebarCard title="H1B Sponsorship">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className={`text-4xl font-semibold ${sponsorshipTone}`}>
              {sponsorshipScore != null ? `${sponsorshipScore}%` : "-"}
            </p>
            <p className={`mt-1 text-sm font-medium ${sponsorshipTone}`}>{sponsorshipLabel}</p>
          </div>
          <ShieldCheck className="h-10 w-10 text-emerald-600/80" />
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Based on historical data and visa-language signals for {companyName}.
        </p>
      </SidebarCard>

      {highlights.length > 0 ? (
        <SidebarCard title="Job Highlights">
          <ul className="space-y-2 text-sm text-muted-foreground">
            {highlights.slice(0, 5).map((highlight) => (
              <li key={highlight} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </SidebarCard>
      ) : null}

      {companySummary ? (
        <SidebarCard title={`About ${companyName}`}>
          <p className="text-sm leading-relaxed text-muted-foreground">{companySummary}</p>
        </SidebarCard>
      ) : null}

      {visibleSkills.length > 0 ? (
        <SidebarCard title="Top Matching Skills">
          <div className="flex flex-wrap gap-2">
            {visibleSkills.map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-border bg-surface-alt px-3 py-1 text-xs font-medium text-strong"
              >
                {skill}
              </span>
            ))}
          </div>
        </SidebarCard>
      ) : null}

      <div className="surface-panel rounded-lg p-4">
        <a
          href={applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Apply Now
          <ExternalLink className="h-4 w-4" />
        </a>
        <Link
          href="/dashboard/applications"
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-3 text-sm font-semibold text-strong transition-colors hover:bg-surface-alt"
        >
          Save Job
          <Bookmark className="h-4 w-4" />
        </Link>
      </div>
    </aside>
  )
}
