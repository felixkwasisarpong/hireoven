"use client"

import { useEffect, useState } from "react"
import { Ghost } from "lucide-react"
import { cn } from "@/lib/utils"
import type { IntelligenceRiskLevel } from "@/types"
import type { GhostRiskApiResponse } from "@/app/api/jobs/[id]/ghost-risk/route"

// ── Props — backward-compatible ───────────────────────────────────────────────

type GhostRiskBadgeProps = {
  /** Pre-computed risk level used when jobId is not provided. */
  riskLevel?: IntelligenceRiskLevel | null | undefined
  freshnessDays?: number | null
  className?: string
  /** When provided, fetches live data from /api/jobs/[id]/ghost-risk. */
  jobId?: string | null
}

// ── Styles ────────────────────────────────────────────────────────────────────

const RING_CLS: Partial<Record<IntelligenceRiskLevel, string>> = {
  high:   "bg-red-50 text-red-800 ring-red-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  low:    "bg-emerald-50 text-emerald-800 ring-emerald-200",
}

const DOT_COLOR: Partial<Record<IntelligenceRiskLevel, string>> = {
  high:   "#DC2626",
  medium: "#D97706",
  low:    "#16A34A",
}

// ── Static variant — keeps the original display logic intact ──────────────────

function StaticBadge({ riskLevel, freshnessDays, className }: {
  riskLevel: IntelligenceRiskLevel | null | undefined
  freshnessDays?: number | null
  className?: string
}) {
  if (!riskLevel || riskLevel === "unknown" || riskLevel === "low") return null

  const isHigh = riskLevel === "high"
  const stale = typeof freshnessDays === "number" && freshnessDays > 30
  if (!isHigh && !stale) return null

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 ring-1 px-2.5 py-0.5 text-[11px] font-semibold",
        RING_CLS[riskLevel] ?? RING_CLS.medium,
        className
      )}
    >
      <span
        className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: DOT_COLOR[riskLevel] }}
      />
      <Ghost className="h-3 w-3 shrink-0" aria-hidden />
      Ghost risk: {isHigh ? "High" : "Medium"}
    </span>
  )
}

// ── Fetching variant — used when jobId is provided ────────────────────────────

function FetchingBadge({ jobId, className }: { jobId: string; className?: string }) {
  const [level, setLevel] = useState<IntelligenceRiskLevel | null>(null)
  const [score, setScore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/ghost-risk`)
      .then((r) => (r.ok ? (r.json() as Promise<GhostRiskApiResponse>) : Promise.reject()))
      .then((d) => { setLevel(d.riskLevel); setScore(d.riskScore); setLoading(false) })
      .catch(() => setLoading(false))
  }, [jobId])

  if (loading) {
    return <span className={cn("inline-block h-5 w-28 animate-pulse rounded bg-slate-100", className)} />
  }
  if (!level || level === "unknown" || level === "low") return null

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 ring-1 px-2.5 py-0.5 text-[11px] font-semibold",
        RING_CLS[level] ?? RING_CLS.medium,
        className
      )}
    >
      <span
        className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: DOT_COLOR[level] }}
      />
      <Ghost className="h-3 w-3 shrink-0" aria-hidden />
      Ghost risk: {level === "high" ? "High" : "Medium"}
      {score != null && <span className="opacity-60">· {score}</span>}
    </span>
  )
}

// ── Public export — same shape as before, with optional jobId ─────────────────

export function GhostRiskBadge({ jobId, riskLevel, freshnessDays, className }: GhostRiskBadgeProps) {
  if (jobId) return <FetchingBadge jobId={jobId} className={className} />
  return <StaticBadge riskLevel={riskLevel} freshnessDays={freshnessDays} className={className} />
}
