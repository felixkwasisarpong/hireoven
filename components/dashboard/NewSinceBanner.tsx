"use client"

import { useEffect, useState } from "react"
import { Sparkles, X } from "lucide-react"

const KEY = "ho:lastDashVisit"
// Only surface the banner when it's been a real gap since the last visit, so it
// doesn't fire on quick reloads or in-session navigation.
const MIN_GAP_MS = 30 * 60 * 1000

/**
 * "N new roles since your last visit" — a lightweight returning-user habit hook.
 * Tracks the last dashboard-visit timestamp in localStorage (client-only, no
 * server state) and asks /api/me/new-since how many fresh, relevant roles
 * appeared since then.
 */
export default function NewSinceBanner() {
  const [count, setCount] = useState(0)
  const [personalized, setPersonalized] = useState(false)
  const [capped, setCapped] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let prev: number | null = null
    try {
      const raw = localStorage.getItem(KEY)
      prev = raw ? Number(raw) : null
    } catch {
      prev = null
    }
    const now = Date.now()
    try {
      localStorage.setItem(KEY, String(now))
    } catch {
      // ignore
    }
    // First-ever visit, or too soon since the last one — nothing to show.
    if (!prev || Number.isNaN(prev) || now - prev < MIN_GAP_MS) return

    const ac = new AbortController()
    fetch(`/api/me/new-since?since=${encodeURIComponent(new Date(prev).toISOString())}`, {
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d: { count?: number; personalized?: boolean; capped?: boolean }) => {
        setCount(d.count ?? 0)
        setPersonalized(Boolean(d.personalized))
        setCapped(Boolean(d.capped))
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  if (dismissed || count <= 0) return null

  const label = capped ? "500+" : count.toLocaleString("en-US")

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
      <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />
      <p className="flex-1 text-[13.5px] text-emerald-900">
        <strong className="font-semibold">
          {label} new {personalized ? "matching roles" : "roles"}
        </strong>{" "}
        since your last visit.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-emerald-700/60 transition hover:text-emerald-900"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
