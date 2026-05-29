"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { X } from "lucide-react"
import { useFeedbackModal } from "@/lib/context/FeedbackModalContext"
import { cn } from "@/lib/utils"

const RATING_LABELS = ["Awful", "Bad", "Okay", "Good", "Great"] as const

/**
 * Global feedback modal. Mounted once at the layout level; opens via
 * useFeedbackModal().open() from anywhere in the tree (sidebar nav item,
 * help-and-support page, etc).
 */
export default function FeedbackModal() {
  const { isOpen, close } = useFeedbackModal()
  const pathname = usePathname()
  const [email, setEmail] = useState("")
  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const handleClose = useCallback(() => {
    close()
    setError(null)
  }, [close])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen, handleClose])

  useEffect(() => {
    if (!sent) return
    const t = window.setTimeout(() => {
      setSent(false)
      setMessage("")
      setRating(null)
      close()
    }, 1800)
    return () => window.clearTimeout(t)
  }, [sent, close])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = message.trim()
    if (trimmed.length < 3) {
      setError("Please share a bit more detail.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/waitlist/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          email: email.trim() || null,
          rating,
          path: pathname ?? null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(typeof data?.error === "string" ? data.error : "Could not send feedback")
        return
      }
      setSent(true)
    } catch {
      setError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      style={{ position: "fixed", inset: 0 }}
      className="z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="feedback-modal-title" className="text-base font-bold text-strong">
              Share feedback
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              We&apos;re still early — your input shapes what ships next.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1 text-muted-foreground hover:bg-surface-alt hover:text-strong"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {sent ? (
          <div className="mt-6 rounded-xl border border-teal-200 bg-teal-50/80 p-4 text-sm font-semibold text-teal-800">
            Thanks — we read every reply.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                How&apos;s the experience? <span className="font-normal">(optional)</span>
              </span>
              <div className="flex gap-1.5">
                {RATING_LABELS.map((label, i) => {
                  const value = i + 1
                  const active = rating === value
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setRating(active ? null : value)}
                      aria-label={`${label} (${value} of 5)`}
                      aria-pressed={active}
                      className={cn(
                        "flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition",
                        active
                          ? "border-teal-600 bg-teal-600 text-white"
                          : "border-input bg-card text-strong hover:bg-surface-alt"
                      )}
                    >
                      {value}
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                What should we know?
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={4}
                maxLength={4000}
                placeholder="Bugs, missing features, what you love, what confused you…"
                className="w-full resize-none rounded-xl border border-input bg-card px-3 py-2 text-sm text-strong shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-teal-500/40"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Email <span className="font-normal">(optional, so we can follow up)</span>
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                autoComplete="email"
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-strong shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-teal-500/40"
              />
            </label>

            {error ? (
              <p className="text-xs font-medium text-red-600" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-surface-alt hover:text-strong"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60"
              >
                {loading ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
