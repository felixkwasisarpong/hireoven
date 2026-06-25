"use client"

import { useEffect, useState } from "react"
import { Star } from "lucide-react"

// Watch toggle wired to the existing /api/watchlist endpoints. Self-fetches its state
// on mount so it can sit on cached/public pages without per-user server rendering.
// Unauthenticated users are sent to sign in, with the company stashed in localStorage
// so it can be added after signup.

type State = "loading" | "anon" | "watched" | "unwatched"

export function WatchButton({
  companyId,
  size = "md",
  className = "",
}: {
  companyId: string
  size?: "sm" | "md"
  className?: string
}) {
  const [state, setState] = useState<State>("loading")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    fetch("/api/watchlist", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) return { anon: true as const }
        const data = (await r.json().catch(() => ({}))) as { watchlist?: Array<{ company_id?: string; company?: { id?: string } }> }
        return { anon: false as const, rows: data.watchlist ?? [] }
      })
      .then((res) => {
        if (!active) return
        if (res.anon) return setState("anon")
        const watched = res.rows.some((w) => (w.company_id ?? w.company?.id) === companyId)
        setState(watched ? "watched" : "unwatched")
      })
      .catch(() => active && setState("unwatched"))
    return () => {
      active = false
    }
  }, [companyId])

  async function toggle() {
    if (state === "anon") {
      try {
        localStorage.setItem("ho_pending_watch", companyId)
      } catch {
        /* ignore */
      }
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
      return
    }
    if (busy) return
    setBusy(true)
    const watching = state === "watched"
    setState(watching ? "unwatched" : "watched") // optimistic
    try {
      await fetch("/api/watchlist", {
        method: watching ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
    } catch {
      setState(watching ? "watched" : "unwatched") // revert
    } finally {
      setBusy(false)
    }
  }

  const on = state === "watched"
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm"

  return (
    <button
      onClick={toggle}
      disabled={state === "loading" || busy}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold transition disabled:opacity-60 ${pad} ${
        on
          ? "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      } ${className}`}
    >
      <Star className={`h-3.5 w-3.5 ${on ? "fill-orange-500 text-orange-500" : ""}`} />
      {state === "loading" ? "…" : on ? "Watching" : state === "anon" ? "Watch" : "Watch"}
    </button>
  )
}
