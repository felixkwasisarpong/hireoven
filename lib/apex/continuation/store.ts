"use client"

import type { ApexContinuationState } from "./types"
import { isEmptyContinuationState, sanitizeContinuationState } from "./sanitize"

const KEY = "hireoven:apex:continuation:v1"
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

type ApexContinuationLocalStore = {
  v: 1
  state: ApexContinuationState
  savedAt: number
}

export type ReadContinuationResult = {
  state: ApexContinuationState | null
  savedAt: number | null
}

function nowMs(): number {
  return Date.now()
}

function defaultRead(): ReadContinuationResult {
  return { state: null, savedAt: null }
}

export function readContinuationState(): ReadContinuationResult {
  if (typeof window === "undefined") return defaultRead()

  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultRead()

    const parsed = JSON.parse(raw) as ApexContinuationLocalStore
    if (parsed.v !== 1 || typeof parsed.savedAt !== "number") return defaultRead()

    if (nowMs() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY)
      return defaultRead()
    }

    const state = sanitizeContinuationState(parsed.state)
    if (isEmptyContinuationState(state)) return defaultRead()

    return { state, savedAt: parsed.savedAt }
  } catch {
    return defaultRead()
  }
}

export function writeContinuationState(state: ApexContinuationState): void {
  if (typeof window === "undefined") return

  const clean = sanitizeContinuationState(state)
  if (isEmptyContinuationState(clean)) {
    clearContinuationState()
    return
  }

  try {
    const payload: ApexContinuationLocalStore = {
      v: 1,
      state: clean,
      savedAt: nowMs(),
    }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {}
}

export function clearContinuationState(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(KEY)
  } catch {}
}
