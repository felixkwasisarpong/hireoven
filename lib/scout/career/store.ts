"use client"

import type { ScoutCareerStrategyResult } from "./types"

const KEY     = "hireoven:scout:career:v1"
const MAX_AGE = 4 * 60 * 60 * 1000   // 4 h — career directions don't change often

type Store = {
  v:       1
  result:  ScoutCareerStrategyResult
  savedAt: number
}

export function readCareerStrategy(): ScoutCareerStrategyResult | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Store
    if (parsed.v !== 1) return null
    if (Date.now() - parsed.savedAt > MAX_AGE) { localStorage.removeItem(KEY); return null }
    return parsed.result
  } catch { return null }
}

export function writeCareerStrategy(result: ScoutCareerStrategyResult): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, result, savedAt: Date.now() } satisfies Store))
  } catch {}
}

export function clearCareerStrategy(): void {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(KEY) } catch {}
}
