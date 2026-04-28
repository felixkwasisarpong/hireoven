import type { ScoutMode } from "./types"

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

export function getScoutModeLabel(mode: ScoutMode): string {
  return SCOUT_MODE_LABELS[mode]
}

function normalizePagePath(pagePath: string): string {
  if (!pagePath) return ""
  const [withoutQuery] = pagePath.split("?")
  const [withoutHash] = withoutQuery.split("#")
  return withoutHash.replace(/\/+$/, "") || "/"
}
