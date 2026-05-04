"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { CompanyHealthScore } from "@/types"

type Props = {
  companyId: string | null | undefined
  className?: string
}

const VERDICT_COLOR: Record<string, string> = {
  strong:  "#1D9E75",
  healthy: "#5DCAA5",
  caution: "#EF9F27",
  critical:"#E24B4A",
}

const VERDICT_LABEL: Record<string, string> = {
  strong:  "Strong",
  healthy: "Healthy",
  caution: "Caution",
  critical:"Critical",
}

export function EmployerHealthBadge({ companyId, className }: Props) {
  const [data, setData] = useState<Pick<CompanyHealthScore, "totalScore" | "verdict"> | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    setLoading(true)
    fetch(`/api/employers/${encodeURIComponent(companyId)}/health-score`)
      .then(r => r.ok ? (r.json() as Promise<CompanyHealthScore>) : Promise.reject())
      .then(d => { setData({ totalScore: d.totalScore, verdict: d.verdict }); setLoading(false) })
      .catch(() => setLoading(false))
  }, [companyId])

  if (!companyId) return null
  if (loading) {
    return <span className={cn("inline-block h-4 w-28 animate-pulse rounded bg-slate-100", className)} />
  }
  if (!data) return null

  const color = VERDICT_COLOR[data.verdict] ?? "#EF9F27"

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[12px]", className)}
      title={`Employer health: ${VERDICT_LABEL[data.verdict]} — Score ${data.totalScore}/100`}
    >
      <span
        className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 4px ${color}80` }}
      />
      <span className="font-semibold" style={{ color }}>
        Health: {VERDICT_LABEL[data.verdict]}
      </span>
      <span className="text-[var(--color-text-muted,#94A3B8)]">· {data.totalScore}</span>
    </span>
  )
}
