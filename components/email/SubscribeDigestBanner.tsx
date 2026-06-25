"use client"

import { useEffect, useState } from "react"
import { Mail, Check } from "lucide-react"

// Wave-1 opt-in CTA for the weekly digest. Self-contained: checks the user's current
// preference and renders nothing if they're already subscribed (or dismissed it), so
// it's safe to drop on any authenticated page. One click subscribes via the existing
// preferences PATCH endpoint.

type State = "loading" | "hidden" | "prompt" | "subscribed"

export function SubscribeDigestBanner({ className = "" }: { className?: string }) {
  const [state, setState] = useState<State>("loading")

  useEffect(() => {
    let active = true
    try {
      if (localStorage.getItem("ho_digest_cta_dismissed") === "1") {
        setState("hidden")
        return
      }
    } catch {
      /* ignore */
    }
    fetch("/api/email/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { preferences?: { weekly_digest?: boolean } } | null) => {
        if (!active) return
        setState(data?.preferences?.weekly_digest ? "hidden" : "prompt")
      })
      .catch(() => active && setState("hidden"))
    return () => {
      active = false
    }
  }, [])

  async function subscribe() {
    setState("subscribed")
    await fetch("/api/email/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekly_digest: true }),
    }).catch(() => {})
  }

  function dismiss() {
    try {
      localStorage.setItem("ho_digest_cta_dismissed", "1")
    } catch {
      /* ignore */
    }
    setState("hidden")
  }

  if (state === "loading" || state === "hidden") return null

  if (state === "subscribed") {
    return (
      <div className={`flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ${className}`}>
        <Check className="h-4 w-4" /> You&rsquo;re subscribed to the weekly digest.
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50">
          <Mail className="h-4 w-4 text-orange-600" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">Get the weekly H-1B digest</p>
          <p className="text-xs text-slate-500">Your score, watched companies, and the week&rsquo;s biggest sponsor movers. Mondays.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={dismiss} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:text-slate-600">
          Not now
        </button>
        <button onClick={subscribe} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600">
          Subscribe
        </button>
      </div>
    </div>
  )
}
