"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { PatternsResponse } from "@/app/api/rejections/patterns/route"

type Props = {
  companyId: string
  jobTitle: string
  className?: string
}

function rateColor(rate: number): string {
  if (rate >= 30) return "#1D9E75"
  if (rate >= 15) return "#D97706"
  return "#DC2626"
}

function rateColorBg(rate: number): string {
  if (rate >= 30) return "#D1FAE5"
  if (rate >= 15) return "#FEF3C7"
  return "#FEE2E2"
}

export function RejectionBadge({ companyId, jobTitle, className }: Props) {
  const [data, setData] = useState<{ rate: number; total: number } | null>(null)

  useEffect(() => {
    if (!companyId) return
    fetch(
      `/api/rejections/patterns?companyId=${encodeURIComponent(companyId)}&jobTitle=${encodeURIComponent(jobTitle)}`
    )
      .then(r => r.ok ? (r.json() as Promise<PatternsResponse>) : Promise.reject())
      .then(d => {
        if (d.insufficientData) return
        setData({ rate: d.interviewRate, total: d.totalSubmissions })
      })
      .catch(() => {})
  }, [companyId, jobTitle])

  if (!data) return null

  const color = rateColor(data.rate)
  const bg    = rateColorBg(data.rate)

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold", className)}
      title={`${data.total} applications reported — ${data.rate}% interview rate`}
    >
      {/* Mini bar */}
      <span className="relative inline-block h-1.5 w-14 overflow-hidden rounded-none bg-slate-200">
        <span
          className="absolute inset-y-0 left-0 transition-[width] duration-500"
          style={{ width: `${Math.min(100, data.rate * 2)}%`, background: color }}
        />
      </span>
      <span style={{ color }}>{data.rate}% interview rate</span>
    </span>
  )
}
