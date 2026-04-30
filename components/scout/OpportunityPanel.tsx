"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Building2, Loader2, Sparkles, TrendingUp, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { OpportunityGraphResponse, OpportunityRecommendation } from "@/lib/scout/opportunity-graph/types"

// ── Single recommendation row ─────────────────────────────────────────────────

function RecommendationRow({
  rec,
  onLaunch,
}: {
  rec:      OpportunityRecommendation
  onLaunch: (query: string) => void
}) {
  const Icon =
    rec.type === "similar_job"             ? Sparkles  :
    rec.type === "adjacent_company"        ? Building2 :
    rec.type === "sponsorship_alternative" ? Building2 :
    rec.type === "skill_unlock"            ? Zap       :
    TrendingUp

  const confidenceDot =
    rec.confidence === "high"   ? "bg-emerald-400" :
    rec.confidence === "medium" ? "bg-amber-400"   : "bg-slate-300"

  return (
    <button
      type="button"
      onClick={() => onLaunch(rec.query)}
      className="group flex w-full items-start gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition hover:border-slate-200 hover:bg-white"
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400 group-hover:text-[#FF5C18]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-slate-800 group-hover:text-[#FF5C18]">
            {rec.title}
          </p>
          {rec.subtitle && (
            <span className="flex-shrink-0 text-xs text-slate-400">— {rec.subtitle}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-5 text-slate-400">{rec.description}</p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2 opacity-0 group-hover:opacity-100">
        <span className={cn("h-1.5 w-1.5 rounded-full", confidenceDot)} title={`${rec.confidence} confidence`} />
        <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
      </div>
    </button>
  )
}

// ── Panel skeleton ────────────────────────────────────────────────────────────

function PanelSkeleton() {
  return (
    <div className="space-y-2 py-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-3">
          <div className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded bg-slate-100 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 rounded bg-slate-100 animate-pulse" />
            <div className="h-3 w-full rounded bg-slate-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main panel component ──────────────────────────────────────────────────────

type Props = {
  /** jobId to build graph around, or null for profile-based recommendations */
  jobId?:        string
  companyId?:    string
  userSkills?:   string[]
  roles?:        string[]
  sponsorship?:  boolean
  onLaunch:      (query: string) => void
  /** Maximum recs to show */
  maxItems?:     number
  /** Show a section header */
  showHeader?:   boolean
}

export function OpportunityPanel({
  jobId,
  companyId,
  userSkills = [],
  roles = [],
  sponsorship = false,
  onLaunch,
  maxItems = 5,
  showHeader = true,
}: Props) {
  const [data,    setData]    = useState<OpportunityGraphResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    const params = new URLSearchParams()
    if (jobId)                    params.set("jobId",       jobId)
    if (companyId)                params.set("companyId",   companyId)
    if (userSkills.length > 0)    params.set("skills",      userSkills.join(","))
    if (roles.length > 0)         params.set("roles",       roles.join(","))
    if (sponsorship)              params.set("sponsorship", "true")

    // Skip if no useful context
    if (!jobId && !companyId && userSkills.length === 0) return

    setLoading(true)
    setError(false)
    fetch(`/api/scout/opportunities?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error()
        const json = (await res.json()) as OpportunityGraphResponse
        setData(json)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [jobId, companyId, userSkills.join(","), roles.join(","), sponsorship])

  const recs = data?.recommendations?.slice(0, maxItems) ?? []
  if (!loading && !error && recs.length === 0) return null

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/60">
      {showHeader && (
        <div className="flex items-center gap-2 border-b border-gray-100 bg-white px-4 py-3">
          <Sparkles className="h-3.5 w-3.5 text-[#FF5C18]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Related opportunities
          </p>
        </div>
      )}

      {loading && <PanelSkeleton />}

      {!loading && error && (
        <p className="px-4 py-3 text-xs text-slate-400">Could not load related opportunities.</p>
      )}

      {!loading && !error && recs.length > 0 && (
        <div className="divide-y divide-slate-50 px-1 py-1">
          {recs.map((rec) => (
            <RecommendationRow key={rec.id} rec={rec} onLaunch={onLaunch} />
          ))}
        </div>
      )}

      {!loading && !error && recs.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2.5">
          <p className="text-[10px] leading-4 text-slate-400">
            Based on skill overlap and hiring patterns. No guarantees implied.
          </p>
        </div>
      )}
    </div>
  )
}
