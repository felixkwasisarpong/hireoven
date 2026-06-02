"use client"

import { useState } from "react"
import { ExternalLink, CheckCircle2 } from "lucide-react"
import { saveJobToPipeline, markJobApplied } from "@/lib/applications/save-job-client"

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
    window.open(applyUrl, "_blank", "noopener,noreferrer")
    if (clicked) return
    setClicked(true)
    // Save as "saved" in background — intent to apply, not confirmation
    saveJobToPipeline({ jobId, jobTitle, companyName, companyLogoUrl, applyUrl, matchScore, source: "hireoven_detail" }).catch(() => {})
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
      <div className="flex flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={handleApply}
          className={className}
        >
          Apply Now
          <ExternalLink className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        </button>
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <span>Did you submit?</span>
          <button
            type="button"
            onClick={handleConfirmApplied}
            disabled={confirming}
            className="font-semibold text-emerald-600 hover:text-emerald-500 disabled:opacity-60"
          >
            {confirming ? "Saving…" : "Yes, I applied"}
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
