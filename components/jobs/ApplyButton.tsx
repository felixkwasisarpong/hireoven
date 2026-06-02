"use client"

import { useState } from "react"
import { ExternalLink } from "lucide-react"
import { markJobApplied } from "@/lib/applications/save-job-client"

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
  const [applied, setApplied] = useState(false)
  const [applying, setApplying] = useState(false)

  async function handleApply() {
    window.open(applyUrl, "_blank", "noopener,noreferrer")
    if (applying || applied) return
    setApplying(true)
    try {
      const result = await markJobApplied({ jobId, jobTitle, companyName, companyLogoUrl, applyUrl, matchScore, source: "hireoven_detail" })
      if (result.ok) setApplied(true)
    } catch {
      // Non-fatal
    } finally {
      setApplying(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleApply}
      disabled={applying}
      className={className}
    >
      {applied ? "Applied ✓" : "Apply Now"}
      {!applied && <ExternalLink className="h-4 w-4" strokeWidth={2.25} aria-hidden />}
    </button>
  )
}
