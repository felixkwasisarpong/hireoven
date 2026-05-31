/**
 * Lightweight sessionStorage persistence for the active Scout workflow.
 * Uses sessionStorage (not localStorage) because workflows are transient —
 * they don't survive a browser restart, unlike workspace session memory.
 */

import type { ScoutActiveWorkflow } from "./types"

const STORAGE_KEY = "hireoven:scout-active-workflow:v1"

export function readActiveWorkflow(): ScoutActiveWorkflow | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ScoutActiveWorkflow
  } catch {
    return null
  }
}

export function writeActiveWorkflow(workflow: ScoutActiveWorkflow): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(workflow))
  } catch {
    // Quota exceeded or private mode — fail silently
  }
}

export function clearActiveWorkflow(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {}
}
