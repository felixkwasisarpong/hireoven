"use client"

/**
 * Scout Timeline Store — append-only localStorage persistence.
 *
 * Bounds:
 *   - Max 100 events (oldest pruned on overflow)
 *   - 24-hour TTL (stale store silently discarded on read)
 *
 * Privacy:
 *   Callers are responsible for never passing sensitive values.
 *   This module stores whatever it receives — the contract is upstream.
 */

import type { ScoutTimelineEvent } from "./types"

const KEY         = "hireoven:scout:timeline:v1"
const MAX_EVENTS  = 100
const MAX_AGE_MS  = 24 * 60 * 60 * 1000   // 24 h

type Store = {
  v:       1
  events:  ScoutTimelineEvent[]   // newest first
  savedAt: number
}

// ── IO ────────────────────────────────────────────────────────────────────────

export function readTimelineEvents(): ScoutTimelineEvent[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Store
    if (parsed.v !== 1) return []
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY)
      return []
    }
    return parsed.events ?? []
  } catch { return [] }
}

function writeTimelineEvents(events: ScoutTimelineEvent[]): void {
  if (typeof window === "undefined") return
  try {
    const store: Store = { v: 1, events, savedAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {}   // quota exceeded or private mode
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Prepend one event. Prunes the oldest if the cap is exceeded. */
export function appendTimelineEvent(event: ScoutTimelineEvent): void {
  const current = readTimelineEvents()
  const next    = [event, ...current].slice(0, MAX_EVENTS)
  writeTimelineEvents(next)
}

export function clearTimeline(): void {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(KEY) } catch {}
}

// ── ID generator (client-safe) ────────────────────────────────────────────────

export function makeTimelineId(): string {
  return `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
