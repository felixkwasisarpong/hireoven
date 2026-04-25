"use client"

import { useCallback, useState } from "react"
import { Share2 } from "lucide-react"

type Props = {
  jobTitle: string
  className?: string
}

export default function JobHeroShareButton({ jobTitle, className }: Props) {
  const [hint, setHint] = useState<string | null>(null)

  const onShare = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : ""
    if (navigator.share) {
      try {
        await navigator.share({ title: jobTitle, text: jobTitle, url })
        setHint(null)
        return
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setHint("Link copied")
      window.setTimeout(() => setHint(null), 2000)
    } catch {
      setHint("Could not copy link")
      window.setTimeout(() => setHint(null), 2000)
    }
  }, [jobTitle])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onShare}
        className={
          className ??
          "grid h-11 w-11 place-items-center rounded-full border border-stone-200/90 bg-white text-stone-800 shadow-md transition hover:bg-stone-50 sm:h-12 sm:w-12"
        }
        aria-label="Share this job"
      >
        <Share2 className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
      </button>
      {hint ? (
        <span className="absolute -bottom-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-stone-900 px-2 py-0.5 text-[11px] font-medium text-white shadow">
          {hint}
        </span>
      ) : null}
    </div>
  )
}
