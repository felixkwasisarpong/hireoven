"use client"

import { useState, useCallback } from "react"
import { ChevronRight } from "lucide-react"
import VisaIntelDrawer from "@/components/jobs/VisaIntelDrawer"
import type { Company, Job } from "@/types"

type Props = {
  job: Job & { company: Company | null }
  displayTitle: string
}

/**
 * Self-contained trigger that owns the open/close state for VisaIntelDrawer.
 * Renders a "Details ›" button; clicking it opens the drawer.
 */
export default function VisaIntelTrigger({ job, displayTitle }: Props) {
  const [open, setOpen] = useState(false)
  const openDrawer = useCallback(() => setOpen(true), [])
  const closeDrawer = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-[#2563EB] transition hover:bg-blue-50 focus-visible:outline-none"
      >
        Details
        <ChevronRight className="h-3 w-3" aria-hidden />
      </button>

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
