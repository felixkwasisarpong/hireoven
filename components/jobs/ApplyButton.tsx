"use client"

import { useState } from "react"
import { ExternalLink, CheckCircle2 } from "lucide-react"
import { markJobApplied } from "@/lib/applications/save-job-client"
import { trackApply } from "@/lib/analytics/session-events"

interface Props {
  jobId: string
  jobTitle: string
  companyName: string
  companyLogoUrl?: string | null
  applyUrl: string
  matchScore?: number | null
  className?: string
}

export default function ApplyButton({
  jobId,
  jobTitle,
  companyName,
  companyLogoUrl,
  applyUrl,
  matchScore,
  className,
}: Props) {
  const [clicked, setClicked] = useState(false)
  const [applied, setApplied] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function handleApply() {
    trackApply()
    window.open(applyUrl, "_blank", "noopener,noreferrer")
    if (clicked) return
    setClicked(true)
  }

  async function handleConfirmApplied() {
    if (confirming || applied) return
    setConfirming(true)
    try {
      await markJobApplied({ jobId, jobTitle, companyName, companyLogoUrl, applyUrl, matchScore, source: "hireoven_detail" })
      setApplied(true)
    } catch {
      // Non-fatal
    } finally {
      setConfirming(false)
    }
  }

  if (applied) {
    return (
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-500">
        <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
        Applied — tracked in pipeline
      </div>
    )
  }

  if (clicked) {
    return (
      <div className="flex flex-col items-end gap-2">
        <button type="button" onClick={handleApply} className={className}>
          Apply Now
          <ExternalLink className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        </button>
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 ring-1 ring-emerald-200">
          <span className="text-[12.5px] font-medium text-emerald-800">Did you apply?</span>
          <button
            type="button"
            onClick={handleConfirmApplied}
            disabled={confirming}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-[12px] font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {confirming ? "Saving…" : "Yes, mark it"}
          </button>
          <button
            type="button"
            onClick={() => setClicked(false)}
            className="text-[12px] text-emerald-700 hover:text-emerald-500"
          >
            Not yet
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={handleApply}
      className={className}
    >
      Apply Now
      <ExternalLink className="h-4 w-4" strokeWidth={2.25} aria-hidden />
    </button>
  )
}
