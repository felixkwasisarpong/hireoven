"use client"

import type {
  ScoutProactiveEvent,
  ScoutProactiveEventType,
  ScoutProactiveSettings,
  ScoutProactiveStore,
} from "./types"

const KEY = "hireoven:scout:proactive:v1"
const MAX_EVENTS = 80
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_CONTROL_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

const DEFAULT_SETTINGS: ScoutProactiveSettings = {
  enabled: true,
  mutedTypes: [],
  snoozedUntil: {},
  dismissedAt: {},
}

function nowMs(): number {
  return Date.now()
}

function tsMs(iso: string | undefined): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

function isEventExpired(event: ScoutProactiveEvent, now: number): boolean {
  const createdMs = tsMs(event.createdAt) ?? now
  if (now - createdMs > MAX_EVENT_AGE_MS) return true
  const expiresMs = tsMs(event.expiresAt)
  if (expiresMs != null && now >= expiresMs) return true
  return false
}

function pruneControlMap(map: Record<string, string>, now: number): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [id, at] of Object.entries(map)) {
    const ms = tsMs(at)
    if (ms == null) continue
    if (now - ms > MAX_CONTROL_AGE_MS) continue
    next[id] = at
  }
  return next
}

function cleanStore(store: ScoutProactiveStore): ScoutProactiveStore {
  const now = nowMs()
  const settings: ScoutProactiveSettings = {
    enabled: store.settings?.enabled ?? true,
    mutedTypes: Array.isArray(store.settings?.mutedTypes) ? [...new Set(store.settings.mutedTypes)] : [],
    snoozedUntil: pruneControlMap(store.settings?.snoozedUntil ?? {}, now),
    dismissedAt: pruneControlMap(store.settings?.dismissedAt ?? {}, now),
  }

  const events = (store.events ?? [])
    .filter((e) => e && typeof e.id === "string" && !isEventExpired(e, now))
    .sort((a, b) => {
      const aMs = tsMs(a.createdAt) ?? 0
      const bMs = tsMs(b.createdAt) ?? 0
      return bMs - aMs
    })
    .slice(0, MAX_EVENTS)

  return {
    v: 1,
    events,
    settings,
    savedAt: now,
  }
}

function defaultStore(): ScoutProactiveStore {
  return {
    v: 1,
    events: [],
    settings: { ...DEFAULT_SETTINGS },
    savedAt: nowMs(),
  }
}

export function readProactiveStore(): ScoutProactiveStore {
  if (typeof window === "undefined") return defaultStore()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultStore()
    const parsed = JSON.parse(raw) as ScoutProactiveStore
    if (parsed.v !== 1) return defaultStore()
    const cleaned = cleanStore(parsed)
    // Opportunistic write-back after prune/sanitize.
    localStorage.setItem(KEY, JSON.stringify(cleaned))
    return cleaned
  } catch {
    return defaultStore()
  }
}

export function writeProactiveStore(store: ScoutProactiveStore): void {
  if (typeof window === "undefined") return
  try {
    const cleaned = cleanStore(store)
    localStorage.setItem(KEY, JSON.stringify(cleaned))
  } catch {}
}

export function readProactiveEvents(): ScoutProactiveEvent[] {
  return readProactiveStore().events
}

export function readProactiveSettings(): ScoutProactiveSettings {
  return readProactiveStore().settings
}

export function upsertProactiveEvents(events: ScoutProactiveEvent[]): ScoutProactiveStore {
  const current = readProactiveStore()
  const byId = new Map<string, ScoutProactiveEvent>()
  for (const e of current.events) byId.set(e.id, e)
  for (const e of events) byId.set(e.id, e)
  const next = cleanStore({
    ...current,
    events: [...byId.values()],
    savedAt: nowMs(),
  })
  writeProactiveStore(next)
  return next
}

function patchSettings(
  patch: (settings: ScoutProactiveSettings) => ScoutProactiveSettings,
): ScoutProactiveStore {
  const current = readProactiveStore()
  const next: ScoutProactiveStore = cleanStore({
    ...current,
    settings: patch(current.settings),
    savedAt: nowMs(),
  })
  writeProactiveStore(next)
  return next
}

export function setProactiveEnabled(enabled: boolean): ScoutProactiveStore {
  return patchSettings((s) => ({ ...s, enabled }))
}

export function dismissProactiveEvent(eventId: string): ScoutProactiveStore {
  return patchSettings((s) => ({
    ...s,
    dismissedAt: {
      ...s.dismissedAt,
      [eventId]: new Date().toISOString(),
    },
  }))
}

export function snoozeProactiveEvent(eventId: string, snoozeMs: number): ScoutProactiveStore {
  const until = new Date(nowMs() + Math.max(60_000, snoozeMs)).toISOString()
  return patchSettings((s) => ({
    ...s,
    snoozedUntil: {
      ...s.snoozedUntil,
      [eventId]: until,
    },
  }))
}

export function muteProactiveType(type: ScoutProactiveEventType): ScoutProactiveStore {
  return patchSettings((s) => ({
    ...s,
    mutedTypes: [...new Set([...s.mutedTypes, type])],
  }))
}

export function unmuteProactiveType(type: ScoutProactiveEventType): ScoutProactiveStore {
  return patchSettings((s) => ({
    ...s,
    mutedTypes: s.mutedTypes.filter((t) => t !== type),
  }))
}

export function clearMutedProactiveTypes(): ScoutProactiveStore {
  return patchSettings((s) => ({
    ...s,
    mutedTypes: [],
  }))
}

export function isProactiveEventSuppressed(
  event: ScoutProactiveEvent,
  settings: ScoutProactiveSettings,
  atMs = nowMs(),
): boolean {
  if (!settings.enabled) return true
  if (settings.mutedTypes.includes(event.type)) return true
  const dismissed = tsMs(settings.dismissedAt[event.id])
  if (dismissed != null && atMs - dismissed < MAX_CONTROL_AGE_MS) return true
  const snoozedUntil = tsMs(settings.snoozedUntil[event.id])
  if (snoozedUntil != null && atMs < snoozedUntil) return true
  return false
}

export function clearProactiveStore(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(KEY)
  } catch {}
}
