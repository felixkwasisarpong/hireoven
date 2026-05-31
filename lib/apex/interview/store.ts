"use client"

/**
 * Interview session localStorage store.
 * Sessions survive page refresh but are pruned after 7 days.
 */

import type { ScoutInterviewSession } from "./types"

const KEY     = "hireoven:scout:interview:v1"
const MAX_AGE = 7 * 24 * 60 * 60 * 1000   // 7 days

type Store = {
  v:        1
  session:  ScoutInterviewSession
  savedAt:  number
}

export function readInterviewSession(): ScoutInterviewSession | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Store
    if (parsed.v !== 1) return null
    if (Date.now() - parsed.savedAt > MAX_AGE) {
      localStorage.removeItem(KEY)
      return null
    }
    return parsed.session
  } catch { return null }
}

export function writeInterviewSession(session: ScoutInterviewSession): void {
  if (typeof window === "undefined") return
  try {
    const store: Store = { v: 1, session, savedAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {}
}

export function clearInterviewSession(): void {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(KEY) } catch {}
}

export function makeInterviewSessionId(): string {
  return `interview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}
