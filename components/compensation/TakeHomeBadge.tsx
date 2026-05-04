"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { CalculateResponse } from "@/app/api/compensation/calculate/route"

type Props = {
  annualSalary: number | null | undefined
  stateCode?: string | null
  className?: string
}

export function TakeHomeBadge({ annualSalary, stateCode, className }: Props) {
  const [monthlyNet, setMonthlyNet] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!annualSalary || annualSalary < 1000) { setMonthlyNet(null); return }
    setLoading(true)
    fetch("/api/compensation/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annualSalary,
        filingStatus: "single",
        location: stateCode ? `, ${stateCode}` : ", TX",
      }),
    })
      .then((r) => r.ok ? (r.json() as Promise<CalculateResponse>) : Promise.reject())
      .then((d) => { setMonthlyNet(d.monthlyNet); setLoading(false) })
      .catch(() => setLoading(false))
  }, [annualSalary, stateCode])

  if (!annualSalary || annualSalary < 1000) return null

  if (loading) {
    return <span className={cn("inline-block h-4 w-24 animate-pulse rounded bg-slate-100", className)} />
  }

  if (!monthlyNet) return null

  return (
    <span className={cn("inline-flex items-baseline gap-1", className)}>
      <span
        className="text-[13px] font-bold tabular-nums"
        style={{ color: "#1D9E75" }}
      >
        ${monthlyNet.toLocaleString()}
      </span>
      <span className="text-[11px] text-[var(--color-text-muted,#94A3B8)]">/ mo take-home</span>
    </span>
  )
}
