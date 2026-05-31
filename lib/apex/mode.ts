import type { ApexMode } from "./types"
import type { ApexSearchProfile } from "./search-profile"

const APEX_MODE_SUGGESTIONS: Record<ApexMode, string[]> = {
  feed: ["Show me jobs worth my time", "Filter high sponsorship roles"],
  job: ["Should I apply?", "What should I fix first?"],
  resume: ["What's weak in my resume?", "Improve this for backend roles"],
  applications: ["What should I follow up on?", "Where am I wasting time?"],
  company: ["Is this company worth targeting?", "How strong is sponsorship here?"],
  apex: ["What should I do next this week?", "Where should I focus today?"],
  general: ["Help me prioritize my job search", "How can I improve outcomes this month?"],
}

const APEX_MODE_LABELS: Record<ApexMode, string> = {
  feed: "Feed Copilot",
  job: "Job Decision Assistant",
  resume: "Resume Assistant",
  applications: "Applications Assistant",
  company: "Company Intelligence Assistant",
  apex: "Apex Command Center",
  general: "Apex Assistant",
}

export function detectApexMode(pagePath: string): ApexMode {
  const path = normalizePagePath(pagePath)

  if (path === "/dashboard/apex") return "apex"
  if (/^\/dashboard\/companies\/[^/]+$/.test(path)) return "company"
  if (/^\/dashboard\/jobs\/[^/]+$/.test(path)) return "job"
  if (path.startsWith("/dashboard/resume")) return "resume"
  if (path.startsWith("/dashboard/applications")) return "applications"
  if (path === "/dashboard") return "feed"

  return "general"
}

export function getApexSuggestionChips(mode: ApexMode): string[] {
  return APEX_MODE_SUGGESTIONS[mode]
}

/**
 * Blends the user's learned search profile with the default mode chips.
 * Profile-derived chips come first; defaults fill remaining slots.
 * Returns at most 4 chips.
 */
export function getPersonalizedChips(
  mode: ApexMode,
  profile: ApexSearchProfile | null,
): string[] {
  const defaults = APEX_MODE_SUGGESTIONS[mode] ?? []
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

  if (profile.preferredRoles?.length && (mode === "feed" || mode === "apex")) {
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

export function getApexModeLabel(mode: ApexMode): string {
  return APEX_MODE_LABELS[mode]
}

function normalizePagePath(pagePath: string): string {
  if (!pagePath) return ""
  const [withoutQuery] = pagePath.split("?")
  const [withoutHash] = withoutQuery.split("#")
  return withoutHash.replace(/\/+$/, "") || "/"
}
