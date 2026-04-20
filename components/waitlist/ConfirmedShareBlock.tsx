"use client"

import { Copy } from "lucide-react"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

export default function ConfirmedShareBlock({ waitlistId }: { waitlistId: string }) {
  const base = getPublicSiteUrl()
  const share = `${base}/launch?ref=${waitlistId}`

  return (
    <div className="mt-10 rounded-2xl border border-border bg-surface-alt p-6 text-left">
      <h2 className="text-lg font-bold text-strong">Move up the waitlist</h2>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        Share Hireoven and move ahead of 10 people for each friend who joins.
      </p>
      {/* TODO: Referral tracking — award position bumps when ref signups are verified. */}
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Your personal share link
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="block flex-1 truncate rounded-lg border border-border bg-card px-3 py-2 text-xs">
          {share}
        </code>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(share)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-strong hover:bg-surface-alt"
        >
          <Copy className="h-4 w-4" aria-hidden />
          Copy
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
            `Join me on the Hireoven waitlist — fresh jobs in minutes. ${share}`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-strong hover:bg-surface-alt"
        >
          Share on X
        </a>
        <a
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(share)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-strong hover:bg-surface-alt"
        >
          LinkedIn
        </a>
      </div>
    </div>
  )
}
