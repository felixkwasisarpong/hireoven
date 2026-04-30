"use client"

/**
 * Scout Timeline Store — append-only localStorage persistence.
 *
 * Bounds:
 *   - Max 240 events (oldest pruned on overflow)
 *   - 48-hour TTL (stale store silently discarded on read)
 *
 * Privacy:
 *   - Never persists sensitive form values/resume/application answers/raw HTML
 *   - Production strips metadata and stores only human-readable event text
 */

import type { ScoutTimelineEvent } from "./types"

const KEY         = "hireoven:scout:timeline:v1"
const SESSION_KEY = "hireoven:scout:timeline:session:v1"
const MAX_EVENTS  = 240
const MAX_AGE_MS  = 48 * 60 * 60 * 1000   // 48 h
const MAX_META_BYTES = 2_000
const DEBUG_EVENT_AGE_MS = 6 * 60 * 60 * 1000 // 6 h
const IS_DEV = process.env.NODE_ENV === "development"

type Store = {
  v:       1
  events:  ScoutTimelineEvent[]   // newest first
  savedAt: number
}

function trimMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined
  try {
    const json = JSON.stringify(meta)
    if (json.length <= MAX_META_BYTES) return meta
    return {
      truncated: true,
      note: "Metadata truncated for timeline storage",
      keys: Object.keys(meta).slice(0, 40),
      size: json.length,
    }
  } catch {
    return { truncated: true, note: "Metadata not serializable" }
  }
}

function getEventTimeMs(event: ScoutTimelineEvent): number {
  const ms = new Date(event.timestamp).getTime()
  return Number.isFinite(ms) ? ms : Date.now()
}

function sanitizeForStorage(event: ScoutTimelineEvent): ScoutTimelineEvent {
  const sessionId = getTimelineSessionId()
  const metadata = IS_DEV
    ? trimMetadata({
        ...event.metadata,
        sessionId,
      })
    : { sessionId }

  return {
    ...event,
    // In prod we keep metadata minimal (session ID only) for grouping/replay safety.
    metadata,
  }
}

function sanitizeOnRead(events: ScoutTimelineEvent[]): ScoutTimelineEvent[] {
  const now = Date.now()
  const cleaned: ScoutTimelineEvent[] = []

  for (const event of events) {
    const age = now - getEventTimeMs(event)
    if (age > MAX_AGE_MS) continue

    if (event.metadata?.debugOnly === true && age > DEBUG_EVENT_AGE_MS) {
      continue
    }

    if (!IS_DEV) {
      const sessionId =
        typeof event.metadata?.sessionId === "string"
          ? event.metadata.sessionId
          : getTimelineSessionId()
      cleaned.push({
        ...event,
        metadata: { sessionId },
      })
      continue
    }

    cleaned.push(event)
  }

  return cleaned.slice(0, MAX_EVENTS)
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
    const next = sanitizeOnRead(parsed.events ?? [])
    // Persist sanitized/pruned content opportunistically.
    if (next.length !== (parsed.events ?? []).length) {
      writeTimelineEvents(next)
    }
    return next
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
  const clean   = sanitizeForStorage(event)
  const next    = [clean, ...current].slice(0, MAX_EVENTS)
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

/**
 * Session identifier used to group timeline rows by browser session/day.
 * Stored in sessionStorage so a new browser tab creates a new session group.
 */
export function getTimelineSessionId(): string {
  if (typeof window === "undefined") return "ssr"
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const created = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    sessionStorage.setItem(SESSION_KEY, created)
    return created
  } catch {
    return `sess-${Date.now()}`
  }
}
