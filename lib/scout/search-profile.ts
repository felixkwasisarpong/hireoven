/**
 * Scout Search Profile — V1 Lightweight Job Search Memory
 *
 * Persists learned search preferences to localStorage (client-side only).
 * Signals are derived from the user's chat interactions, filter applications,
 * and explicit commands — NOT from passive browsing or sensitive fields.
 *
 * Privacy rules:
 *   - Never infers demographic traits or protected characteristics
 *   - Stores only search preferences (roles, locations, work modes, sponsorship)
 *   - User can clear all memory at any time
 *   - Expires after 30 days of inactivity
 *   - Visible and editable via "Scout learned" chips in the UI
 */

import type { ScoutResponse, ScoutAction } from "./types"

// ── Type ─────────────────────────────────────────────────────────────────────

export type ScoutSearchProfile = {
  preferredRoles?: string[]
  preferredLocations?: string[]
  preferredWorkModes?: Array<"remote" | "hybrid" | "onsite">
  preferredSkills?: string[]
  avoidedSkills?: string[]
  sponsorshipPreference?: "required" | "preferred" | "not_needed" | "unknown"
  salaryPreference?: { min?: number; currency?: string }
  companyPreferences?: { liked?: string[]; avoided?: string[] }
  seniorityPreference?: string[]
  updatedAt: string
}

// A single editable memory item surfaced to the user
export type ScoutMemoryChip = {
  key: string
  label: string
  /** Field path + value to clear when dismissed */
  fieldKey: keyof ScoutSearchProfile
  fieldValue?: unknown
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "hireoven:scout-search-profile:v1"
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function readSearchProfile(): ScoutSearchProfile | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ScoutSearchProfile
    if (
      parsed.updatedAt &&
      Date.now() - new Date(parsed.updatedAt).getTime() > MAX_AGE_MS
    ) {
      clearSearchProfile()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeSearchProfile(profile: ScoutSearchProfile): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // quota or private mode — fail silently
  }
}

export function clearSearchProfile(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

// ── Merge helper ──────────────────────────────────────────────────────────────

function dedup<T>(arr: T[], max: number): T[] {
  return [...new Set(arr)].slice(0, max)
}

export function mergeProfileUpdate(
  current: ScoutSearchProfile | null,
  update: Partial<ScoutSearchProfile>
): ScoutSearchProfile {
  const base = current ?? { updatedAt: new Date().toISOString() }

  return {
    ...base,
    ...update,
    preferredRoles: dedup(
      [...(update.preferredRoles ?? []), ...(base.preferredRoles ?? [])],
      6
    ),
    preferredLocations: dedup(
      [...(update.preferredLocations ?? []), ...(base.preferredLocations ?? [])],
      4
    ),
    preferredWorkModes: dedup(
      [...(update.preferredWorkModes ?? []), ...(base.preferredWorkModes ?? [])],
      3
    ),
    preferredSkills: dedup(
      [...(update.preferredSkills ?? []), ...(base.preferredSkills ?? [])],
      8
    ),
    companyPreferences: {
      liked: dedup(
        [
          ...(update.companyPreferences?.liked ?? []),
          ...(base.companyPreferences?.liked ?? []),
        ],
        10
      ),
      avoided: dedup(
        [
          ...(update.companyPreferences?.avoided ?? []),
          ...(base.companyPreferences?.avoided ?? []),
        ],
        10
      ),
    },
    updatedAt: new Date().toISOString(),
  }
}

// ── Signal extraction from Scout chat interactions ────────────────────────────

/** Patterns that indicate sponsorship is required */
const SPONSORSHIP_REQUIRED_RE = /\b(sponsor(?:ship)?|h[- ]?1b|visa|opt|cpt|ead|need.*sponsor|require.*sponsor)\b/i
/** Remote / hybrid / onsite detection */
const REMOTE_RE = /\bremote\b/i
const HYBRID_RE = /\bhybrid\b/i
const ONSITE_RE = /\b(onsite|on-site|in.?office|in.?person)\b/i

const COMMON_TITLE_STOP = new Set([
  "senior", "junior", "lead", "staff", "principal", "associate", "intern",
  "role", "position", "job", "jobs", "opportunity", "opening",
  "and", "the", "for", "with", "at", "of", "in", "a", "an",
])

function extractRoleKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,/()\[\]|–—]+/)
    .filter((w) => w.length > 3 && !COMMON_TITLE_STOP.has(w))
    .slice(0, 3)
}

/**
 * Extracts a partial profile update from a single Scout chat turn.
 * Signal sources: APPLY_FILTERS action, message text patterns, Scout recommendation.
 */
export function extractProfileUpdate(
  response: ScoutResponse,
  userMessage: string,
): Partial<ScoutSearchProfile> {
  const update: Partial<ScoutSearchProfile> = {}

  // ── APPLY_FILTERS action — most reliable signal ───────────────────────────
  const filterAction = response.actions?.find(
    (a): a is Extract<ScoutAction, { type: "APPLY_FILTERS" }> => a.type === "APPLY_FILTERS"
  )
  if (filterAction) {
    const p = filterAction.payload

    if (p.query) {
      const keywords = extractRoleKeywords(p.query)
      if (keywords.length > 0) update.preferredRoles = keywords
    }

    if (p.location) {
      update.preferredLocations = [p.location.trim()]
    }

    if (p.workMode) {
      const mode = p.workMode.toLowerCase()
      if (mode === "remote") update.preferredWorkModes = ["remote"]
      else if (mode === "hybrid") update.preferredWorkModes = ["hybrid"]
      else if (mode === "onsite") update.preferredWorkModes = ["onsite"]
    }

    if (p.sponsorship === "high") {
      update.sponsorshipPreference = "required"
    } else if (p.sponsorship === "moderate") {
      update.sponsorshipPreference = "preferred"
    }
  }

  // ── Message text patterns ─────────────────────────────────────────────────

  const msg = userMessage.toLowerCase()

  // Sponsorship intent
  if (SPONSORSHIP_REQUIRED_RE.test(msg) && !update.sponsorshipPreference) {
    update.sponsorshipPreference = "required"
  }

  // Work mode intent
  if (!update.preferredWorkModes) {
    if (REMOTE_RE.test(msg)) update.preferredWorkModes = ["remote"]
    else if (HYBRID_RE.test(msg)) update.preferredWorkModes = ["hybrid"]
    else if (ONSITE_RE.test(msg)) update.preferredWorkModes = ["onsite"]
  }

  // Company liked/avoided from compare winner
  if (response.compare?.winnerJobId) {
    const winner = response.compare.items.find(
      (i) => i.jobId === response.compare!.winnerJobId
    )
    if (winner?.company) {
      update.companyPreferences = { liked: [winner.company] }
    }
  }

  return update
}

// ── "Scout learned" chip generation ─────────────────────────────────────────

/**
 * Returns up to 3 human-readable memory chips representing what Scout has
 * learned about the user's preferences. Each chip can be individually dismissed.
 */
export function buildMemoryChips(profile: ScoutSearchProfile): ScoutMemoryChip[] {
  const chips: ScoutMemoryChip[] = []

  if (profile.sponsorshipPreference === "required") {
    chips.push({
      key: "sponsorship",
      label: "Prefers sponsorship-friendly roles",
      fieldKey: "sponsorshipPreference",
    })
  } else if (profile.sponsorshipPreference === "preferred") {
    chips.push({
      key: "sponsorship",
      label: "Often searches sponsorship-friendly companies",
      fieldKey: "sponsorshipPreference",
    })
  }

  if (profile.preferredWorkModes?.includes("remote")) {
    chips.push({
      key: "remote",
      label: "Prefers remote work",
      fieldKey: "preferredWorkModes",
    })
  } else if (profile.preferredWorkModes?.includes("hybrid")) {
    chips.push({ key: "hybrid", label: "Prefers hybrid work", fieldKey: "preferredWorkModes" })
  }

  if (profile.preferredRoles?.length) {
    const roles = profile.preferredRoles.slice(0, 2).join(", ")
    chips.push({
      key: "roles",
      label: `Interested in ${roles} roles`,
      fieldKey: "preferredRoles",
    })
  }

  if (profile.preferredLocations?.length) {
    chips.push({
      key: "locations",
      label: `Targets ${profile.preferredLocations[0]}`,
      fieldKey: "preferredLocations",
    })
  }

  return chips.slice(0, 3)
}

// ── Claude context formatting ─────────────────────────────────────────────────

/**
 * Formats the search profile as a compact string for the Scout prompt.
 * Marked as "weak hints" so Claude doesn't over-weight them.
 */
export function formatProfileForClaude(profile: ScoutSearchProfile | null): string {
  if (!profile) return ""

  const lines: string[] = []

  if (profile.sponsorshipPreference && profile.sponsorshipPreference !== "unknown") {
    const labels = {
      required: "user has indicated sponsorship is required",
      preferred: "user tends to prefer sponsorship-friendly roles",
      not_needed: "user appears to not require sponsorship",
    }
    lines.push(`- Sponsorship signal: ${labels[profile.sponsorshipPreference]}`)
  }

  if (profile.preferredWorkModes?.length) {
    lines.push(`- Work mode preference: ${profile.preferredWorkModes.join(", ")}`)
  }

  if (profile.preferredRoles?.length) {
    lines.push(`- Inferred role interests: ${profile.preferredRoles.slice(0, 4).join(", ")}`)
  }

  if (profile.preferredLocations?.length) {
    lines.push(`- Location preference: ${profile.preferredLocations.join(", ")}`)
  }

  if (profile.companyPreferences?.liked?.length) {
    lines.push(`- Liked company types: ${profile.companyPreferences.liked.slice(0, 3).join(", ")}`)
  }

  if (lines.length === 0) return ""

  return `Search Profile (lightweight preferences — use as soft hints, do not over-weight):\n${lines.join("\n")}`
}
