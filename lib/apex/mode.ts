import type { ScoutMode } from "./types"
import type { ScoutSearchProfile } from "./search-profile"

const SCOUT_MODE_SUGGESTIONS: Record<ScoutMode, string[]> = {
  feed: ["Show me jobs worth my time", "Filter high sponsorship roles"],
  job: ["Should I apply?", "What should I fix first?"],
  resume: ["What's weak in my resume?", "Improve this for backend roles"],
  applications: ["What should I follow up on?", "Where am I wasting time?"],
  company: ["Is this company worth targeting?", "How strong is sponsorship here?"],
  scout: ["What should I do next this week?", "Where should I focus today?"],
  general: ["Help me prioritize my job search", "How can I improve outcomes this month?"],
}

const SCOUT_MODE_LABELS: Record<ScoutMode, string> = {
  feed: "Feed Copilot",
  job: "Job Decision Assistant",
  resume: "Resume Assistant",
  applications: "Applications Assistant",
  company: "Company Intelligence Assistant",
  scout: "Scout Command Center",
  general: "Scout Assistant",
}

export function detectScoutMode(pagePath: string): ScoutMode {
  const path = normalizePagePath(pagePath)

  if (path === "/dashboard/scout") return "scout"
  if (/^\/dashboard\/companies\/[^/]+$/.test(path)) return "company"
  if (/^\/dashboard\/jobs\/[^/]+$/.test(path)) return "job"
  if (path.startsWith("/dashboard/resume")) return "resume"
  if (path.startsWith("/dashboard/applications")) return "applications"
  if (path === "/dashboard") return "feed"

  return "general"
}

export function getScoutSuggestionChips(mode: ScoutMode): string[] {
  return SCOUT_MODE_SUGGESTIONS[mode]
}

/**
 * Blends the user's learned search profile with the default mode chips.
 * Profile-derived chips come first; defaults fill remaining slots.
 * Returns at most 4 chips.
 */
export function getPersonalizedChips(
  mode: ScoutMode,
  profile: ScoutSearchProfile | null,
): string[] {
  const defaults = SCOUT_MODE_SUGGESTIONS[mode] ?? []
  if (!profile) return defaults

  const personal: string[] = []

  if (profile.sponsorshipPreference === "required") {
    personal.push("Show sponsorship-friendly roles")
  } else if (profile.sponsorshipPreference === "preferred") {
    personal.push("Filter high sponsorship roles")
  }

  if (profile.preferredWorkModes?.includes("remote") && mode !== "applications") {
    personal.push("Remote-only roles")
  }

  if (profile.preferredRoles?.length && (mode === "feed" || mode === "scout")) {
    personal.push(`Find ${profile.preferredRoles[0]} jobs`)
  }

  if (profile.companyPreferences?.liked?.length) {
    const co = profile.companyPreferences.liked[0]
    personal.push(`Companies like ${co}`)
  }

  // Fill remaining with defaults (no duplicates)
  for (const d of defaults) {
    if (personal.length >= 4) break
    if (!personal.includes(d)) personal.push(d)
  }

  return personal.slice(0, 4)
}

export function getScoutModeLabel(mode: ScoutMode): string {
  return SCOUT_MODE_LABELS[mode]
}

function normalizePagePath(pagePath: string): string {
  if (!pagePath) return ""
  const [withoutQuery] = pagePath.split("?")
  const [withoutHash] = withoutQuery.split("#")
  return withoutHash.replace(/\/+$/, "") || "/"
}
