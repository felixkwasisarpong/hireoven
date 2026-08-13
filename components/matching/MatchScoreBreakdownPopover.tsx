"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Briefcase, Check, ScanSearch, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { getMatchVerdict } from "@/lib/jobs/match-score-display"
import { resolveSkillsFactorValue, type ScoreFactorComputationState } from "@/lib/matching/score-factor-state"
import type { JobMatchScore } from "@/types"

type Dimension = {
  label: string
  value: number | null
  weight: number
  hint?: string
  state?: ScoreFactorComputationState
}

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value))
}

function barColor(value: number | null): string {
  if (value == null) return "bg-slate-200"
  if (value >= 80) return "bg-emerald-500"
  if (value >= 60) return "bg-blue-500"
  if (value >= 40) return "bg-amber-500"
  return "bg-rose-400"
}

function ConfidenceTag({ confidence }: { confidence: string | null }) {
  if (!confidence) return null
  const tone =
    confidence === "high"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : confidence === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-100 text-slate-600"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone
      )}
    >
      {confidence} confidence
    </span>
  )
}

function DimensionBar({ dim }: { dim: Dimension }) {
  const pct = dim.value == null ? 0 : clamp(dim.value, 0, 100)
  const notComputed = (dim.state ?? (dim.value == null ? "not_computed" : "computed")) === "not_computed"
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-semibold text-slate-700">{dim.label}</span>
        <span className="tabular-nums text-slate-500">
          {notComputed ? "Not computed" : `${pct}`}
          <span className="ml-1 text-slate-400">· {Math.round(dim.weight * 100)}%</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-[width]", barColor(dim.value))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

type BreakdownPanelProps = {
  score: JobMatchScore
  onClose: () => void
  onSeeFullAnalysis?: () => void
}

function formatConcern(raw: string): string {
  // Convert internal gate labels into something readable.
  if (raw.startsWith("Gate: missing_required_cert")) return "Missing a required certification"
  if (raw.startsWith("Gate: missing_required_skills_gt75pct"))
    return "Missing more than 75% of required skills"
  if (raw.startsWith("Gate: low_signal_skills_lt5"))
    return "Sparse skill evidence in this posting"
  if (raw.startsWith("Gate: insufficient_experience"))
    return "Well below the stated minimum years of experience"
  if (raw.startsWith("Gate: below_preferred_experience"))
    return "Somewhat under the preferred years of experience"
  if (raw.startsWith("Gate: insufficient_relevant_experience"))
    return "Not enough recent experience in this role family"
  if (raw.startsWith("Gate: limited_relevant_experience"))
    return "Enough total years, but limited directly relevant years"
  if (raw.startsWith("Gate: extreme_seniority_mismatch")) return "Seniority is far from the role"
  if (raw.startsWith("Gate: seniority_mismatch")) return "Seniority level differs from the role"
  if (raw.startsWith("Gate: same_family_low_title_fit"))
    return "Same broad career family, but the title evidence is weak"
  if (raw.startsWith("Gate: role_family_mismatch")) {
    const m = /role_family_mismatch:(.+?)→(.+)$/.exec(raw)
    if (m) return `Career family mismatch (your background: ${m[1]} → role: ${m[2]})`
    return "Career family mismatch with your recent roles"
  }
  return raw.replace(/^Gate:\s*/, "")
}

function formatCareerFitLabel(label: string | null | undefined): string {
  if (label === "ats_ready") return "ATS ready"
  if (label === "tailor_resume") return "Tailor resume"
  if (label === "bridge_first") return "Bridge first"
  if (label === "career_pivot") return "Career pivot"
  return "Career fit"
}

function formatYears(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "0"
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

function BreakdownPanel({ score, onClose, onSeeFullAnalysis }: BreakdownPanelProps) {
  const breakdown = score.score_breakdown ?? null
  const overall = score.overall_score
  const verdict = getMatchVerdict(overall)
  const skillsFactor = resolveSkillsFactorValue({ fastScore: score })

  const dimensions: Dimension[] = [
    { label: "Skills", value: skillsFactor.value, weight: 0.36, state: skillsFactor.state },
    { label: "Experience", value: breakdown?.experienceScore ?? score.seniority_score, weight: 0.14 },
    { label: "Seniority", value: breakdown?.seniorityScore ?? score.seniority_score, weight: 0.06 },
    { label: "Role family", value: breakdown?.roleFamilyScore ?? null, weight: 0.14 },
    { label: "Title fit", value: score.role_fit_score, weight: 0.1 },
    { label: "Education", value: score.education_score, weight: 0.09 },
    { label: "Semantic", value: breakdown?.semanticScore ?? null, weight: 0.06 },
    { label: "Domain", value: score.domain_score ?? breakdown?.domainScore ?? null, weight: 0.03 },
    { label: "Certifications", value: breakdown?.certificationScore ?? null, weight: 0.02 },
  ]

  const matched = breakdown?.matchedSkills?.slice(0, 6) ?? []
  const missing = breakdown?.missingSkills?.slice(0, 6) ?? []
  const concerns = (breakdown?.concerns ?? []).map(formatConcern).filter(Boolean)
  const matchedCount = score.matching_skills_count ?? matched.length
  const requiredCount = score.total_required_skills ?? 0
  const careerFit = breakdown?.careerFit ?? null

  return (
    <div
      role="dialog"
      aria-label="Match score breakdown"
      className="popover-panel w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
      onClick={(e) => e.stopPropagation()}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold leading-none tabular-nums text-slate-900">
              {overall}
            </span>
            <span className="text-sm font-semibold text-slate-500">%</span>
            <span className={cn("ml-1 text-[12px] font-semibold", verdict.colorClass)}>
              {verdict.label}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <ConfidenceTag confidence={breakdown?.confidence ?? null} />
            {requiredCount > 0 && (
              <span className="text-[11px] text-slate-500">
                {matchedCount}/{requiredCount} required skills
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close breakdown"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {careerFit && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="truncate text-[12px] font-semibold text-slate-800">
                {formatCareerFitLabel(careerFit.label)}
              </span>
            </div>
            {careerFit.requiredYears && careerFit.requiredYears > 0 ? (
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                {formatYears(careerFit.relevantYears)}/{formatYears(careerFit.requiredYears)} relevant yrs
              </span>
            ) : (
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                {formatYears(careerFit.relevantYears)} relevant yrs
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-white px-2 py-1.5">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <ScanSearch className="h-3 w-3" /> ATS screen
              </div>
              <div className="mt-0.5 text-[15px] font-bold tabular-nums text-slate-900">
                {careerFit.atsScreenScore ?? "N/A"}
              </div>
            </div>
            <div className="rounded-md bg-white px-2 py-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Career fit
              </div>
              <div className="mt-0.5 text-[15px] font-bold tabular-nums text-slate-900">
                {careerFit.careerFitScore ?? "N/A"}
              </div>
            </div>
          </div>
          {careerFit.recommendation && (
            <p className="mt-2 text-[11px] leading-snug text-slate-600">
              {careerFit.recommendation}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 space-y-2.5">
        {dimensions.map((dim) => (
          <DimensionBar key={dim.label} dim={dim} />
        ))}
      </div>

      {(matched.length > 0 || missing.length > 0) && (
        <div className="mt-4 space-y-2.5">
          {matched.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                <Check className="h-3 w-3" /> You have
              </div>
              <div className="flex flex-wrap gap-1">
                {matched.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
          {missing.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                <AlertTriangle className="h-3 w-3" /> Missing
              </div>
              <div className="flex flex-wrap gap-1">
                {missing.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {concerns.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Why it&apos;s capped
          </div>
          <ul className="space-y-0.5 text-[12px] text-amber-900">
            {concerns.slice(0, 4).map((concern, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="mt-0.5 inline-block h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                <span>{concern}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onSeeFullAnalysis && (
        <button
          type="button"
          onClick={onSeeFullAnalysis}
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] font-semibold text-indigo-600 transition hover:bg-indigo-100"
        >
          See full analysis →
        </button>
      )}
    </div>
  )
}

type MatchScoreBreakdownPopoverProps = {
  score: JobMatchScore | null
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  onSeeFullAnalysis?: () => void
}

type Coords = { top: number; left: number; placeAbove: boolean }

function computeCoords(anchor: HTMLElement): Coords {
  const rect = anchor.getBoundingClientRect()
  const POPOVER_WIDTH = 340
  const POPOVER_HEIGHT_ESTIMATE = 420
  const GAP = 8

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  // Prefer below; flip above if not enough room.
  const spaceBelow = viewportHeight - rect.bottom
  const placeAbove = spaceBelow < POPOVER_HEIGHT_ESTIMATE + GAP && rect.top > spaceBelow

  const top = placeAbove
    ? rect.top + window.scrollY - POPOVER_HEIGHT_ESTIMATE - GAP
    : rect.bottom + window.scrollY + GAP

  // When the anchor sits in the right portion of the viewport (e.g. the score
  // ring at a card's right edge, next to the sidebar), open the panel leftward so
  // it lands over the card instead of colliding with the sidebar. Otherwise
  // center it under the anchor. Always clamp to the viewport with 12px padding.
  const centerX = rect.left + rect.width / 2
  const anchorOnRight = centerX > viewportWidth * 0.55
  let left = anchorOnRight
    ? rect.right - POPOVER_WIDTH + window.scrollX
    : centerX - POPOVER_WIDTH / 2 + window.scrollX
  const minLeft = window.scrollX + 12
  const maxLeft = window.scrollX + viewportWidth - POPOVER_WIDTH - 12
  left = Math.max(minLeft, Math.min(maxLeft, left))

  return { top, left, placeAbove }
}

export function MatchScoreBreakdownPopover({
  score,
  open,
  anchorRef,
  onClose,
  onSeeFullAnalysis,
}: MatchScoreBreakdownPopoverProps) {
  const [coords, setCoords] = useState<Coords | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open || !anchorRef.current) return
    setCoords(computeCoords(anchorRef.current))

    function update() {
      if (anchorRef.current) setCoords(computeCoords(anchorRef.current))
    }
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open || !score || !coords || typeof document === "undefined") return null

  // Anchored popover — faint scrim focuses it; panel positioned next to the ring.
  const panel: ReactNode = (
    <>
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 999 }} className="bg-black/5" />
      <div
        ref={panelRef}
        style={{ position: "absolute", top: coords.top, left: coords.left, zIndex: 1000 }}
      >
        <BreakdownPanel
          score={score}
          onClose={onClose}
          onSeeFullAnalysis={onSeeFullAnalysis}
        />
      </div>
    </>
  )

  return createPortal(panel, document.body)
}
