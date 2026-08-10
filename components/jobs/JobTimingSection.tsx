"use client"

import { useEffect, useState } from "react"
import { TimingPanel, type TimingPanelData } from "@/components/apex/TimingPanel"

/**
 * Job-detail apply-timing panel. Fetches the (cached, cron-refreshed) timing
 * score + screen-rate heatmap for this job and renders the full TimingPanel —
 * the detailed counterpart to the compact urgency badge on the feed card.
 * Renders nothing if timing data can't be loaded, so it never breaks the page.
 */
export default function JobTimingSection({
  jobId,
  applyUrl,
  jobTitle,
}: {
  jobId: string
  applyUrl?: string | null
  jobTitle?: string
}) {
  const [data, setData] = useState<TimingPanelData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/jobs/${jobId}/timing`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: TimingPanelData) => alive && setData({ ...d, jobTitle }))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [jobId, jobTitle])

  if (failed || !data) return null

  return (
    <TimingPanel
      data={data}
      onApplyNow={() => {
        if (applyUrl) window.open(applyUrl, "_blank", "noopener,noreferrer")
      }}
    />
  )
}
