"use client"

import { useCallback, useEffect, useState } from "react"

export type InsightCard =
  | { type: "pivot"; id: string; priority: number; pivot: PivotPayload }
  | {
      type: "sharpen"
      id: string
      priority: number
      primaryKey: string
      primaryLabel: string
      runnerUpKey: string
      runnerUpLabel: string
    }
  | { type: "skill_boost"; id: string; priority: number; fieldKey: string; fieldLabel: string; skills: string[] }

export type PivotPayload = {
  fromKey: string
  fromLabel: string
  toKey: string
  toLabel: string
  currentFit: number
  currentJobCount: number
  targetJobCount: number
  jobMultiple: number
  currentSponsorship?: number
  targetSponsorship?: number
  sponsorDelta: number
  bridgeSkills: string[]
  driver: "demand" | "sponsorship" | "both"
}

const DISMISS_KEY = "feed-insights-dismissed"

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

/**
 * Fetches the feed's intelligence cards once and manages per-card dismissal
 * (persisted) so a card the user closes stays gone until its underlying advice
 * changes (the card id encodes the advice). `activeCards` are the not-yet-
 * dismissed cards in priority order, ready to interleave into the feed.
 */
export function useFeedInsights(enabled: boolean) {
  const [cards, setCards] = useState<InsightCard[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!enabled) return
    setDismissed(readDismissed())
    let alive = true
    fetch("/api/feed/insights")
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((data: { cards?: InsightCard[] }) => {
        if (alive) setCards(Array.isArray(data.cards) ? data.cards : [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [enabled])

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(id)
      try {
        window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const affirmSkills = useCallback(async (skills: string[]) => {
    try {
      await fetch("/api/resume/skills/affirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skills }),
      })
    } catch {
      /* best-effort — the chip still shows affirmed locally */
    }
  }, [])

  // D5: the feed shows ONE rotating insight card, not several. Rotate which card
  // appears across loads (persisted counter) so it isn't always the same type,
  // and cap it to a single card in the stream.
  const [rotation] = useState(() => {
    if (typeof window === "undefined") return 0
    const n = Number(window.localStorage.getItem("feed-insights-rotation") ?? "0")
    try {
      window.localStorage.setItem("feed-insights-rotation", String(n + 1))
    } catch {
      /* ignore */
    }
    return n
  })

  const activeCards = cards.filter((c) => !dismissed.has(c.id))
  const card = activeCards.length > 0 ? activeCards[rotation % activeCards.length] : null
  return { card, dismiss, affirmSkills }
}
