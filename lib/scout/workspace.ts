import type { ScoutAction, ScoutResponse } from "./types"

export type WorkspaceMode = "idle" | "search" | "compare" | "tailor" | "applications"

export type WorkspaceRail = {
  title: string
  summary?: string
  actions?: ScoutAction[]
}

export type ScoutWorkspaceDirective = {
  mode: WorkspaceMode
  transition?: "replace" | "push" | "slide-right" | "none"
  payload?: Record<string, unknown>
  rail?: WorkspaceRail | null
  chips?: string[]
}

/**
 * Infers the workspace mode from a Scout response.
 * The server can explicitly set mode via workspace_directive (future);
 * for now, we pattern-match on the response shape.
 */
export function inferWorkspaceMode(response: ScoutResponse): WorkspaceMode {
  if (response.compare) return "compare"
  if (response.interviewPrep || response.intent === "interview_prep") return "applications"
  if (response.workflow || response.intent === "workflow") return "applications"
  if (response.actions?.some((a) => a.type === "OPEN_RESUME_TAILOR")) return "tailor"
  if (
    response.actions?.some((a) => a.type === "APPLY_FILTERS") ||
    response.mode === "feed"
  )
    return "search"
  return "idle"
}

/** Extract the APPLY_FILTERS payload as a URL query string for the job feed. */
export function buildFeedUrl(response: ScoutResponse): string {
  const action = response.actions?.find((a) => a.type === "APPLY_FILTERS")
  if (!action || action.type !== "APPLY_FILTERS") return "/dashboard"
  const p = action.payload
  const params = new URLSearchParams()
  if (p.query) params.set("q", String(p.query))
  if (p.location) params.set("location", String(p.location))
  if (p.workMode) params.set("workMode", String(p.workMode))
  if (p.sponsorship) params.set("sponsorship", String(p.sponsorship))
  const qs = params.toString()
  return qs ? `/dashboard?${qs}` : "/dashboard"
}
