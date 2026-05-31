"use client"

import type { ApexResearchTask } from "./types"

const KEY     = "apex:research:last"
const MAX_AGE = 4 * 60 * 60 * 1000   // 4 h

export function readResearchTask(): ApexResearchTask | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const { task, savedAt } = JSON.parse(raw) as { task: ApexResearchTask; savedAt: string }
    if (Date.now() - new Date(savedAt).getTime() > MAX_AGE) {
      localStorage.removeItem(KEY)
      return null
    }
    return task
  } catch { return null }
}

export function writeResearchTask(task: ApexResearchTask): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(KEY, JSON.stringify({ task, savedAt: new Date().toISOString() }))
  } catch {}
}

export function clearResearchTask(): void {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(KEY) } catch {}
}
