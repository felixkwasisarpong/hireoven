"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { CohortListItem } from "@/app/api/cohorts/route"

type Props = {
  companyId: string | null | undefined
  className?: string
}

export function CohortBadge({ companyId, className }: Props) {
  const [cohort, setCohort] = useState<Pick<CohortListItem, "id" | "member_count"> | null>(null)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/cohorts?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ cohorts: CohortListItem[] }>) : Promise.reject()))
      .then((d) => {
        if (!cancelled && d.cohorts.length > 0) setCohort(d.cohorts[0])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [companyId])

  if (!cohort) return null

  return (
    <>
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
      <a
        href={`/dashboard/cohorts#${cohort.id}`}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors",
          className
        )}
        title="Former employees from this company are actively job-hunting together"
      >
        <span className="material-icons text-[12px] leading-none" aria-hidden>group</span>
        {cohort.member_count} former employee{cohort.member_count !== 1 ? "s" : ""} in cohort
      </a>
    </>
  )
}
