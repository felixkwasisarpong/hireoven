"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

type Props = {
  companyId: string | null | undefined
  className?: string
  size?: "sm" | "md"
}

type BadgeData = {
  isFairChance: boolean
  pledgeType?: string
  verified?: boolean
}

const PLEDGE_SHORT: Record<string, string> = {
  fair_chance_pledge: "Fair Chance Pledge",
  ban_the_box: "Ban the Box",
  second_chance: "Second Chance",
}

export function FairChanceBadge({ companyId, className, size = "sm" }: Props) {
  const [data, setData] = useState<BadgeData | null>(null)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/background-check/fair-chance-badge?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<BadgeData>) : Promise.reject()))
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [companyId])

  if (!companyId || !data?.isFairChance) return null

  return (
    <>
      <link
        href="https://fonts.googleapis.com/icon?family=Material+Icons"
        rel="stylesheet"
      />
      <span
        className={cn(
          "inline-flex items-center gap-1 font-medium border border-emerald-200 bg-emerald-50 text-emerald-700",
          size === "sm" ? "rounded-full px-2 py-0.5 text-[11px]" : "rounded-full px-3 py-1 text-[12px]",
          className
        )}
        title={
          data.pledgeType
            ? `${PLEDGE_SHORT[data.pledgeType] ?? data.pledgeType} commitment`
            : "Fair chance hiring commitment"
        }
      >
        <span
          className={cn(
            "material-icons leading-none",
            size === "sm" ? "text-[12px]" : "text-[14px]"
          )}
        >
          verified_user
        </span>
        Fair Chance Employer
      </span>
    </>
  )
}
