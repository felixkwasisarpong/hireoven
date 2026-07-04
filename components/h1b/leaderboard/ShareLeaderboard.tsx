"use client"

import { useState } from "react"
import { Link2, Check } from "lucide-react"

// Prefilled share buttons. `path` is the canonical leaderboard path; we build the
// absolute URL client-side so scoped (state/industry) pages share themselves.
export default function ShareLeaderboard({
  path,
  text,
}: {
  path: string
  text: string
}) {
  const [copied, setCopied] = useState(false)
  const base =
    typeof window !== "undefined" ? window.location.origin : "https://hireoven.com"
  const url = `${base}${path}`

  const twitter = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    text
  )}&url=${encodeURIComponent(url)}`
  const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
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
    <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-500">Share:</span>
      <a
        href={twitter}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-50"
      >
        X / Twitter
      </a>
      <a
        href={linkedin}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-50"
      >
        LinkedIn
      </a>
      <button
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-50"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  )
}
