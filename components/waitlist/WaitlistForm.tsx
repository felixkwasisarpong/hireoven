"use client"

import { useCallback, useMemo, useState } from "react"
import confetti from "canvas-confetti"
import { useSearchParams } from "next/navigation"
import { Check, Copy, Linkedin, Twitter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

type Variant = "simple" | "expanded"

type Props = {
  variant: Variant
  className?: string
  /** Optional override for share link (otherwise from API response) */
  waitlistId?: string | null
  id?: string
  /** Unique per form instance on the page */
  emailInputId?: string
}

const HEAR_OPTIONS = [
  { value: "twitter", label: "Twitter / X" },
  { value: "reddit", label: "Reddit" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "friend", label: "Friend" },
  { value: "university", label: "University / Discord" },
  { value: "other", label: "Other" },
]

const VISA_OPTIONS = [
  { value: "opt", label: "OPT" },
  { value: "stem_opt", label: "STEM OPT" },
  { value: "h1b", label: "H-1B" },
  { value: "other", label: "Other visa situation" },
]

function fireConfetti() {
  const count = 80
  const defaults = { origin: { y: 0.75 }, zIndex: 100 }

  confetti({
    ...defaults,
    particleCount: count,
    spread: 70,
    startVelocity: 35,
    colors: ["#1D9E75", "#0f172a", "#E8F7F2"],
  })
}

export default function WaitlistForm({
  variant,
  className,
  waitlistId,
  id = "launch-waitlist-form",
  emailInputId = "waitlist-email-input",
}: Props) {
  const sp = useSearchParams()
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [returnedId, setReturnedId] = useState<string | null>(null)

  const [expandedOpen, setExpandedOpen] = useState(false)
  const [isInternational, setIsInternational] = useState(false)
  const [visaStatus, setVisaStatus] = useState("")
  const [university, setUniversity] = useState("")
  const [hearAbout, setHearAbout] = useState("")

  const referrer = useMemo(() => {
    const parts: string[] = []
    const us = sp.get("utm_source")
    const um = sp.get("utm_medium")
    const uc = sp.get("utm_campaign")
    const ut = sp.get("utm_term")
    const uct = sp.get("utm_content")
    if (us) parts.push(`utm_source=${encodeURIComponent(us)}`)
    if (um) parts.push(`utm_medium=${encodeURIComponent(um)}`)
    if (uc) parts.push(`utm_campaign=${encodeURIComponent(uc)}`)
    if (ut) parts.push(`utm_term=${encodeURIComponent(ut)}`)
    if (uct) parts.push(`utm_content=${encodeURIComponent(uct)}`)
    const ref = sp.get("ref")
    if (ref) parts.push(`ref=${encodeURIComponent(ref)}`)
    return parts.length ? parts.join("&") : undefined
  }, [sp])

  const metadata = useMemo(() => {
    const m: Record<string, string> = {}
    const ref = sp.get("ref")
    if (ref) m.landing_ref = ref
    return Object.keys(m).length ? m : undefined
  }, [sp])

  const refId = waitlistId ?? returnedId

  const shareUrl = useMemo(() => {
    const base = getPublicSiteUrl()
    const u = new URL("/launch", base)
    if (refId) u.searchParams.set("ref", refId)
    return u.toString()
  }, [refId])

  const tweetText =
    "Just joined the waitlist for @hireoven - a job board that shows you listings within minutes of being posted, not days. Also has H1B sponsorship scoring for international candidates. hireoven.com/launch"

  const linkedInUrl = useMemo(() => {
    const u = new URL("https://www.linkedin.com/sharing/share-offsite/")
    u.searchParams.set("url", shareUrl)
    return u.toString()
  }, [shareUrl])

  const twitterUrl = useMemo(() => {
    const u = new URL("https://twitter.com/intent/tweet")
    u.searchParams.set("text", tweetText)
    return u.toString()
  }, [tweetText])

  const trackShare = useCallback(
    async (channel: "twitter" | "linkedin" | "copy") => {
      if (!email) return
      try {
        await fetch("/api/waitlist/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, channel }),
        })
      } catch {
        /* ignore */
      }
    },
    [email]
  )

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const source =
        variant === "expanded" && hearAbout
          ? hearAbout
          : "launch_page"

      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          isInternational: variant === "expanded" ? isInternational : undefined,
          visaStatus:
            variant === "expanded" && isInternational && visaStatus
              ? visaStatus
              : undefined,
          university:
            variant === "expanded" && isInternational && university
              ? university
              : undefined,
          source,
          referrer,
          metadata,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong")
        return
      }
      setSuccess(true)
      setMessage(typeof data.message === "string" ? data.message : null)
      if (typeof data.id === "string") setReturnedId(data.id)
      fireConfetti()
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-teal-200 bg-teal-50/80 p-6 text-left shadow-sm",
          className
        )}
      >
        <p className="text-lg font-bold text-strong">You&apos;re on the waitlist!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Check your email - we sent a confirmation.
        </p>
        {message ? (
          <p className="mt-3 text-sm font-semibold text-teal-700">{message}</p>
        ) : null}

        <p className="mt-6 text-sm font-semibold text-strong">
          Know other job seekers? Share Hireoven:
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={twitterUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void trackShare("twitter")}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-strong transition hover:bg-surface-alt"
          >
            <Twitter className="h-4 w-4" aria-hidden />
            Twitter / X
          </a>
          <a
            href={linkedInUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void trackShare("linkedin")}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-strong transition hover:bg-surface-alt"
          >
            <Linkedin className="h-4 w-4" aria-hidden />
            LinkedIn
          </a>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(shareUrl)
              void trackShare("copy")
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-strong transition hover:bg-surface-alt"
          >
            <Copy className="h-4 w-4" aria-hidden />
            Copy link
          </button>
        </div>
      </div>
    )
  }

  return (
    <form id={id} onSubmit={onSubmit} className={cn("space-y-4", className)}>
      <div
        className={cn(
          variant === "simple" &&
            "flex flex-col gap-3 sm:flex-row sm:items-stretch"
        )}
      >
        <label className="sr-only" htmlFor={emailInputId}>
          Email
        </label>
        <input
          id={emailInputId}
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={cn(
            "min-h-[48px] w-full rounded-xl border border-input bg-card px-4 text-base text-strong shadow-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-teal-500/40",
            variant === "simple" && "sm:flex-1"
          )}
        />
        <Button
          type="submit"
          disabled={loading}
          className="h-12 shrink-0 rounded-xl bg-teal-600 px-6 text-base font-semibold text-white hover:bg-teal-700"
        >
          {loading ? "Joining…" : "Join the waitlist →"}
        </Button>
      </div>

      {variant === "expanded" ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setExpandedOpen((v) => !v)}
            className="text-sm font-semibold text-teal-700 underline-offset-4 hover:underline"
          >
            {expandedOpen ? "Hide extra fields" : "Tell us more"}
          </button>

          {expandedOpen ? (
            <div className="space-y-4 rounded-2xl border border-border bg-surface-alt/60 p-4">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={isInternational}
                  onChange={(e) => setIsInternational(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input"
                />
                <span className="text-strong">
                  Are you an international student?
                </span>
              </label>

              {isInternational ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Visa status
                    </label>
                    <select
                      value={visaStatus}
                      onChange={(e) => setVisaStatus(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"
                    >
                      <option value="">Select…</option>
                      {VISA_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      University
                    </label>
                    <input
                      type="text"
                      value={university}
                      onChange={(e) => setUniversity(e.target.value)}
                      placeholder="e.g. NYU"
                      className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  How did you hear about us?
                </label>
                <select
                  value={hearAbout}
                  onChange={(e) => setHearAbout(e.target.value)}
                  className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"
                >
                  <option value="">Optional</option>
                  {HEAR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {variant === "simple" ? (
        <p className="text-xs text-muted-foreground">
          Free forever for early members. No spam. Unsubscribe anytime.
        </p>
      ) : null}

      {error ? (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

export function WaitlistSuccessCheck() {
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-100">
      <Check className="h-9 w-9 text-teal-700" strokeWidth={2.5} />
    </div>
  )
}
