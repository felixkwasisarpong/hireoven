/**
 * Scout Autonomous Research Mode — Types V1
 *
 * Bounded multi-step research: gathers real evidence, synthesizes findings,
 * streams results progressively.
 *
 * Safety contract:
 *  - All findings are evidence-backed (real DB counts / market signals)
 *  - Confidence reflects data quality, never implies guaranteed outcomes
 *  - No fabricated statistics, no invented sponsorship claims
 *  - Bounded: max 5 steps, 30 s wall-clock, 10 s per step
 */

// ── Core task model ───────────────────────────────────────────────────────────

export type ScoutResearchTaskStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "completed"
  | "failed"

export type ScoutResearchStepStatus = "pending" | "running" | "completed" | "failed"

export type ScoutResearchFindingType =
  | "job_cluster"
  | "company_pattern"
  | "skill_gap"
  | "market_signal"
  | "sponsorship_pattern"
  | "career_path"

export type ScoutResearchFinding = {
  type:       ScoutResearchFindingType
  title:      string
  summary:    string
  evidence?:  string[]
  confidence?: number
  /** Clickable actions the user can take from this finding */
  actions?: { label: string; command: string }[]
}

export type ScoutResearchStep = {
  id:         string
  title:      string
  status:     ScoutResearchStepStatus
  agent?:     string
  summary?:   string
  durationMs?: number
}

export type ScoutResearchTask = {
  id:          string
  title:       string
  objective:   string
  status:      ScoutResearchTaskStatus
  steps:       ScoutResearchStep[]
  findings?:   ScoutResearchFinding[]
  createdAt:   string
  completedAt?: string
  followUpCommands?: string[]
}

// ── Research SSE event protocol ───────────────────────────────────────────────
// Used by /api/scout/research — separate from ScoutStreamEvent (chat stream).

export type ResearchSSEEvent =
  | { type: "research_init";       task:      ScoutResearchTask }
  | { type: "research_step_start"; stepId:    string; title: string }
  | { type: "research_step_done";  stepId:    string; summary: string; durationMs: number }
  | { type: "research_finding";    finding:   ScoutResearchFinding }
  | { type: "research_complete";   task:      ScoutResearchTask }
  | { type: "research_error";      message:   string }

export function encodeResearchSSE(event: ResearchSSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export function parseResearchSSELine(line: string): ResearchSSEEvent | null {
  if (!line.startsWith("data: ")) return null
  try { return JSON.parse(line.slice(6)) as ResearchSSEEvent } catch { return null }
}
