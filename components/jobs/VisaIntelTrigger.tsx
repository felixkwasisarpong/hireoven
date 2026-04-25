"use client"

import { useState } from "react"
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
 * Self-contained trigger that owns the open/close state for VisaIntelDrawer
 * (which is built on Radix Dialog).
 *
 * - With `children`, the entire wrapped area becomes a real <button>.
 * - Without children, renders a compact "Details ›" button.
 */
export default function VisaIntelTrigger({ job, displayTitle, children, className }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {children ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Open Visa Intelligence details"
          className={cn(
            "block w-full cursor-pointer rounded-xl border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/35",
            className
          )}
        >
          {children}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-[#2563EB] transition hover:bg-blue-50 focus-visible:outline-none"
        >
          Details
          <ChevronRight className="h-3 w-3" aria-hidden />
        </button>
      )}

      <VisaIntelDrawer
        open={open}
        onOpenChange={setOpen}
        job={job}
        displayTitle={displayTitle}
      />
    </>
  )
}
