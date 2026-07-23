"use client"

import { Copy } from "lucide-react"
import { getShareOrigin } from "@/lib/waitlist/site-url"

export default function ConfirmedShareBlock({ waitlistId }: { waitlistId: string }) {
  const base = getShareOrigin()
  const share = `${base}/launch?ref=${waitlistId}`

  return (
    <div className="term-panel mt-10 p-6 text-left">
      <h2 className="text-lg font-semibold text-white">Move up the waitlist</h2>
      <p className="mt-2 text-sm leading-relaxed text-[#ccd6cf]/60">
        Share Hireoven and move ahead of 10 people for each friend who joins.
      </p>
      {/* TODO: Referral tracking - award position bumps when ref signups are verified. */}
      <p className="term-label mt-4">your personal share link</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="block flex-1 truncate border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-3 py-2 text-xs text-[#ccd6cf]/70">
          {share}
        </code>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(share)}
          className="inline-flex items-center justify-center gap-2 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-4 py-2 text-sm font-semibold text-[#ccd6cf]/80 transition-colors hover:border-[#38e08a] hover:text-[#38e08a]"
        >
          <Copy className="h-4 w-4" aria-hidden />
          Copy
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
            `Join me on the Hireoven waitlist - fresh jobs in minutes. ${share}`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="border border-[rgba(120,200,160,0.2)] px-3 py-1.5 text-xs font-semibold text-[#ccd6cf]/80 transition-colors hover:border-[#38e08a] hover:text-[#38e08a]"
        >
          Share on X
        </a>
        <a
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(share)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="border border-[rgba(120,200,160,0.2)] px-3 py-1.5 text-xs font-semibold text-[#ccd6cf]/80 transition-colors hover:border-[#38e08a] hover:text-[#38e08a]"
        >
          LinkedIn
        </a>
      </div>
    </div>
  )
}
