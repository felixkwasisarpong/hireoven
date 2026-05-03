"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { SponsorshipTruthData, SponsorshipVerdict } from "@/app/api/employers/[id]/sponsorship-truth/route"

type Props = {
  companyId: string | null | undefined
  className?: string
}

type BadgeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; score: number; verdict: SponsorshipVerdict }

function dotColor(verdict: SponsorshipVerdict): string {
  if (verdict === "active_sponsor") return "#1D9E75"
  if (verdict === "unverified") return "#D97706"
  return "#94A3B8"
}

function scoreColor(score: number): string {
  if (score >= 70) return "#1D9E75"
  if (score >= 40) return "#D97706"
  return "#DC2626"
}

function verdictWord(verdict: SponsorshipVerdict): string {
  if (verdict === "active_sponsor") return "Verified"
  if (verdict === "unverified") return "Unverified"
  if (verdict === "claims_only") return "Claimed"
  return "No data"
}

export function SponsorshipTruthBadge({ companyId, className }: Props) {
  const [state, setState] = useState<BadgeState>({ status: "idle" })

  useEffect(() => {
    if (!companyId) return
    setState({ status: "loading" })
    fetch(`/api/employers/${encodeURIComponent(companyId)}/sponsorship-truth`)
      .then((r) => (r.ok ? (r.json() as Promise<SponsorshipTruthData>) : Promise.reject()))
      .then((d) => setState({ status: "ready", score: d.score, verdict: d.verdict }))
      .catch(() => setState({ status: "error" }))
  }, [companyId])

  if (!companyId || state.status === "error" || state.status === "idle") return null

  if (state.status === "loading") {
    return (
      <span className={cn("inline-flex h-5 w-[90px] animate-pulse rounded bg-slate-100", className)} />
    )
  }

  const { score, verdict } = state

  return (
    <span
      className={cn(
        "inline-flex max-w-[120px] items-center gap-1.5 text-[11px]",
        className
      )}
      title={`Sponsorship Truth Score: ${score} — ${verdictWord(verdict)}`}
    >
      {/* colored status dot */}
      <span
        className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: dotColor(verdict) }}
      />
      {/* score number */}
      <span
        className="font-bold tabular-nums leading-none"
        style={{ color: scoreColor(score) }}
      >
        {score}
      </span>
      {/* verdict word */}
      <span className="truncate font-medium text-[var(--color-text-muted,theme(colors.slate.500))]">
        {verdictWord(verdict)}
      </span>
    </span>
  )
}
