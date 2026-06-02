import type { ApexAction, ApexResponse, ApexWorkspaceDirective, ApexWorkspaceMode } from "./types"

export type { ApexWorkspaceDirective, ApexWorkspaceMode }

export type WorkspaceMode = ApexWorkspaceMode

export type WorkspaceRail = {
  title: string
  summary?: string
  actions?: ApexAction[]
}

/**
 * Infers the workspace mode from a Apex response.
 * Used as a fallback when the response does not include a workspace_directive.
 */
export function inferWorkspaceMode(response: ApexResponse): WorkspaceMode {
  // Explicit directive is the primary signal — check all valid modes first
  const dm = response.workspace_directive?.mode
  if (dm && dm !== "idle") return dm

  if (response.outreach) return "outreach"
  if (response.compare) return "compare"
  if (response.interviewPrep || response.intent === "interview_prep") return "interview"
  if (response.workflow || response.intent === "workflow") return "applications"
  if (response.actions?.some((a) => a.type === "OPEN_RESUME_TAILOR")) return "tailor"
  if (response.actions?.some((a) => a.type === "OPEN_COMPANY")) return "company"
  if (response.actions?.some((a) => a.type === "APPLY_FILTERS") || response.mode === "feed") return "search"

  // Text-pattern fallback — catches cases where Claude responds in natural
  // language without a workspace_directive JSON block
  const text = (response.answer ?? "").toLowerCase()
  if (/1-click apply|one-click apply|auto.?apply|apply (for|to) me automatically|set up.*apply|pre.?approve.*appl/i.test(text)) return "auto_apply"
  if (/autonomous hunt|attack plan|highest-?conviction batch|top of the queue/i.test(text)) return "autonomous_hunt"
  if (/shadow network|who do (you|i) know|referral path|warm intro|linkedin connection/i.test(text)) return "shadow_network"
  if (/reputation guard|ghosting rate|employer score|trust.*compan|is.*good place to work/i.test(text)) return "reputation_guard"
  if (/jd decoder|decode.*job|x-ray.*posting|read between the lines|hidden expectation/i.test(text)) return "jd_decoder"
  if (/pipeline sim|probability.*offer|monte carlo|how long.*search|weeks to offer|my odds/i.test(text)) return "pipeline_sim"

  return "idle"
}

/** Extract the APPLY_FILTERS payload as a URL query string for the job feed. */
export function buildFeedUrl(response: ApexResponse): string {
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
