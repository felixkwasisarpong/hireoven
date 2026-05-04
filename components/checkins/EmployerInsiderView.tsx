"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { InsiderViewStats } from "@/lib/checkins/signal-extractor"

type Props = {
  companyId: string | null | undefined
  className?: string
}

function StatRow({
  icon,
  label,
  value,
  isWarning,
}: {
  icon: string
  label: string
  value: string
  isWarning?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span
        className={cn(
          "material-icons text-[16px] leading-none shrink-0",
          isWarning ? "text-amber-500" : "text-emerald-500"
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="flex-1 text-[13px] text-slate-600">{label}</span>
      <span
        className={cn(
          "text-[13px] font-semibold",
          isWarning ? "text-amber-600" : "text-slate-800"
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function EmployerInsiderView({ companyId, className }: Props) {
  const [stats, setStats] = useState<InsiderViewStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    let cancelled = false
    fetch(`/api/employers/${encodeURIComponent(companyId)}/insider-view`)
      .then((r) => (r.ok ? (r.json() as Promise<{ stats: InsiderViewStats | null }>) : Promise.reject()))
      .then((d) => { if (!cancelled) setStats(d.stats) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companyId])

  if (loading || !stats) return null

  const satisfactionLabel =
    stats.avgSatisfaction !== null
      ? `${stats.avgSatisfaction.toFixed(1)} / 5`
      : null

  return (
    <>
      <link
        href="https://fonts.googleapis.com/icon?family=Material+Icons"
        rel="stylesheet"
      />
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            From employees on this platform
          </p>
          <span className="text-[11px] text-slate-400">
            {stats.checkinCount} check-in{stats.checkinCount !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {satisfactionLabel && (
            <StatRow
              icon="star"
              label="Avg satisfaction"
              value={satisfactionLabel}
              isWarning={stats.avgSatisfaction !== null && stats.avgSatisfaction < 3}
            />
          )}
          {stats.recommendRate !== null && (
            <StatRow
              icon={stats.recommendRate >= 70 ? "thumb_up" : "thumb_down"}
              label="Would recommend"
              value={`${stats.recommendRate}%`}
              isWarning={stats.recommendRate < 50}
            />
          )}
          {stats.roleAccuracyRate !== null && (
            <StatRow
              icon={stats.roleAccuracyRate >= 70 ? "check_circle" : "warning"}
              label="Role matched description"
              value={`${stats.roleAccuracyRate}%`}
              isWarning={stats.roleAccuracyRate < 60}
            />
          )}
          {stats.compensationAccuracyRate !== null && (
            <StatRow
              icon={stats.compensationAccuracyRate >= 70 ? "check_circle" : "warning"}
              label="Compensation was accurate"
              value={`${stats.compensationAccuracyRate}%`}
              isWarning={stats.compensationAccuracyRate < 70}
            />
          )}
          {stats.redFlagRate !== null && stats.redFlagRate > 0 && (
            <StatRow
              icon="flag"
              label="Reported red flags"
              value={`${stats.redFlagRate}%`}
              isWarning={stats.redFlagRate > 20}
            />
          )}
        </div>

        <p className="text-[11px] text-slate-400 pt-1">
          Anonymized · verified through post-hire check-ins
        </p>
      </div>
    </>
  )
}
