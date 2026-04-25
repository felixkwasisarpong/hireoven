"use client"

import { useState, useCallback } from "react"
import { ChevronRight } from "lucide-react"
import VisaIntelDrawer from "@/components/jobs/VisaIntelDrawer"
import { cn } from "@/lib/utils"
import type { Company, Job } from "@/types"

type Props = {
  job: Job & { company: Company | null }
  displayTitle: string
  children?: React.ReactNode
  className?: string
}

/**
 * Self-contained trigger that owns the open/close state for VisaIntelDrawer.
 * With children, the whole child area opens the drawer. Without children, it
 * renders a compact "Details ›" trigger.
 */
export default function VisaIntelTrigger({ job, displayTitle, children, className }: Props) {
  const [open, setOpen] = useState(false)
  const openDrawer = useCallback(() => setOpen(true), [])
  const closeDrawer = useCallback(() => setOpen(false), [])

  return (
    <>
      {children ? (
        <div className={cn("relative block w-full text-left", className)}>
          {children}
          <button
            type="button"
            aria-label="Open Visa Intelligence details"
            onClick={openDrawer}
            className="absolute inset-0 z-20 rounded-xl bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/35"
          >
            <span className="sr-only">Open Visa Intelligence details</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openDrawer}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-[#2563EB] transition hover:bg-blue-50 focus-visible:outline-none"
        >
          Details
          <ChevronRight className="h-3 w-3" aria-hidden />
        </button>
      )}

      {open && (
        <VisaIntelDrawer
          job={job}
          displayTitle={displayTitle}
          onClose={closeDrawer}
        />
      )}
    </>
  )
}
