"use client"

import { cn } from "@/lib/utils"

type Props = {
  riskScore: number | null | undefined
  riskLevel: string | null | undefined
  className?: string
}

const LEVEL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: "Ghost risk",  color: "#DC2626", bg: "#FEF2F2" },
  medium: { label: "Risky",       color: "#D97706", bg: "#FFFBEB" },
}

export function GhostRiskBadge({ riskScore, riskLevel, className }: Props) {
  const level = riskLevel?.toLowerCase()
  const cfg = level ? LEVEL_CONFIG[level] : null
  if (!cfg || riskScore == null) return null

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[12px]", className)}
      title={`Ghost job risk: ${cfg.label} (score ${riskScore})`}
    >
      <span
        className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: cfg.color, boxShadow: `0 0 4px ${cfg.color}80` }}
      />
      <span className="font-semibold" style={{ color: cfg.color }}>
        {cfg.label}
      </span>
      <span className="text-[var(--color-text-muted,#94A3B8)]">· {riskScore}</span>
    </span>
  )
}
