/**
 * Scout workspace session — lightweight localStorage persistence.
 *
 * PERSISTS:   last mode, last 5 user commands, last chips, rail label/summary,
 *             safe mode metadata (filter summary, compare count, etc.)
 *
 * NEVER PERSISTS: resume text, job descriptions, raw API responses,
 *                 actions arrays (contain stale IDs), profile data,
 *                 conversation messages, explanations blocks.
 *
 * Sessions expire after 24 hours and are silently discarded.
 */

import type { WorkspaceMode, WorkspaceRail } from "./workspace"
import type { ScoutResponse } from "./types"

export const STORAGE_KEY = "hireoven:scout-workspace:v1"

const MAX_COMMANDS = 5
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

// ── Session shape ─────────────────────────────────────────────────────────────

export type ScoutWorkspaceSession = {
  /** Schema version — bump if shape changes. */
  v: 1
  mode: WorkspaceMode
  /** Suggestion chips active at time of save. */
  chips: string[]
  /** Last N user command strings (not Scout answers). */
  recentCommands: string[]
  /** Rail label only — actions are NOT stored (may reference stale IDs). */
  rail: { title: string; summary?: string } | null
  /** Safe, human-readable summaries of the last active mode. */
  modeMetadata: {
    search?: { filterSummary: string }
    compare?: { summary: string; itemCount: number }
    tailor?: { hint: string }
    applications?: { type: "workflow" | "interview" }
  }
  savedAt: number
}

// ── IO helpers ────────────────────────────────────────────────────────────────

export function readScoutSession(): ScoutWorkspaceSession | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ScoutWorkspaceSession
    if (parsed.v !== 1) return null
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      clearScoutSession()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeScoutSession(
  session: Omit<ScoutWorkspaceSession, "v" | "savedAt">
): void {
  if (typeof window === "undefined") return
  try {
    const full: ScoutWorkspaceSession = { v: 1, savedAt: Date.now(), ...session }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(full))
  } catch {
    // Quota exceeded or private mode — fail silently
  }
}

export function clearScoutSession(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Fail silently
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Prepend a new command and deduplicate, capped at MAX_COMMANDS. */
export function appendCommand(
  current: string[],
  command: string
): string[] {
  return [command, ...current.filter((c) => c !== command)].slice(0, MAX_COMMANDS)
}

/** Extract only safe, non-sensitive metadata from a Scout response for persistence. */
export function extractModeMetadata(
  mode: WorkspaceMode,
  response: ScoutResponse
): ScoutWorkspaceSession["modeMetadata"] {
  switch (mode) {
    case "search": {
      const action = response.actions?.find((a) => a.type === "APPLY_FILTERS")
      if (!action || action.type !== "APPLY_FILTERS") return {}
      const p = action.payload
      const parts = [p.query, p.location, p.workMode, p.sponsorship].filter(Boolean)
      return { search: { filterSummary: parts.join(", ") || "custom filters" } }
    }
    case "compare": {
      const c = response.compare
      if (!c) return {}
      // Store the human-readable summary string and count — NOT the items (which have jobIds)
      return { compare: { summary: c.summary, itemCount: c.items.length } }
    }
    case "tailor": {
      // OPEN_RESUME_TAILOR action may have jobId — we deliberately discard it
      return { tailor: { hint: "Resume tailoring" } }
    }
    case "applications": {
      return {
        applications: { type: response.interviewPrep ? "interview" : "workflow" },
      }
    }
    default:
      return {}
  }
}

/** Extract only the label/summary from a rail (no actions, no IDs). */
export function extractRailMetadata(
  rail: WorkspaceRail | null
): ScoutWorkspaceSession["rail"] {
  if (!rail) return null
  return { title: rail.title, summary: rail.summary }
}
