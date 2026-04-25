"use client"

import { useCallback, useState } from "react"
import { Check, Facebook, Linkedin, Link2, Twitter } from "lucide-react"

type Props = {
  jobTitle: string
  /** Public marketing URL for share links — falls back to current href in the browser. */
  shareUrl?: string
}

const BTN_BASE =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg text-white shadow-sm transition hover:brightness-110"

export default function JobShareRow({ jobTitle, shareUrl }: Props) {
  const [copied, setCopied] = useState(false)

  const url =
    typeof window !== "undefined"
      ? shareUrl ?? window.location.href
      : shareUrl ?? ""

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }, [url])

  const encoded = encodeURIComponent(url)
  const text = encodeURIComponent(jobTitle)

  return (
    <div className="flex items-center gap-2">
      <a
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${BTN_BASE} bg-[#0A66C2]`}
        aria-label="Share on LinkedIn"
      >
        <Linkedin className="h-4 w-4" />
      </a>
      <a
        href={`https://twitter.com/intent/tweet?url=${encoded}&text=${text}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${BTN_BASE} bg-[#1DA1F2]`}
        aria-label="Share on Twitter"
      >
        <Twitter className="h-4 w-4" />
      </a>
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${BTN_BASE} bg-[#1877F2]`}
        aria-label="Share on Facebook"
      >
        <Facebook className="h-4 w-4" />
      </a>
      <button
        type="button"
        onClick={copy}
        className={`${BTN_BASE} bg-slate-700 hover:bg-slate-800`}
        aria-label={copied ? "Link copied" : "Copy link"}
      >
        {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
      </button>
    </div>
  )
}
