"use client"

import { useState } from "react"
import { Link2, Check } from "lucide-react"
import type { ScorecardPayload } from "@/types/h1b-scorecard"

export function ScorecardShare({ data }: { data: ScorecardPayload }) {
  const [copied, setCopied] = useState(false)
  const base =
    typeof window !== "undefined" ? window.location.origin : "https://hireoven.com"
  const url = `${base}${data.scorecard_url}`

  const text = `${data.company.name} scored ${data.bucket.grade} (${data.score}/100) on H-1B sponsorability. Source: DOL LCA + USCIS public data.`
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    text
  )}&url=${encodeURIComponent(url)}`
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
    url
  )}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="my-8 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-500">Share this scorecard:</span>
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
      >
        X / Twitter
      </a>
      <a
        href={linkedinUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
      >
        LinkedIn
      </a>
      <button
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  )
}
