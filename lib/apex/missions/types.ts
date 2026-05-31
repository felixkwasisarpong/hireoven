/**
 * Apex Daily Mission System — Types
 *
 * Missions are daily focus priorities, not gamification.
 * Tone: calm, strategic, assistant-like. Never shame or fake urgency.
 */

export type ApexMissionType =
  | "applications"
  | "resume"
  | "compare"
  | "interview"
  | "market_research"
  | "follow_up"

export type ApexMissionPriority = "low" | "medium" | "high"

export type ApexMissionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "dismissed"

export type ApexMission = {
  id:                string
  type:              ApexMissionType
  title:             string
  summary:           string
  priority:          ApexMissionPriority
  status:            ApexMissionStatus
  /** The Apex command bar query to run when user clicks the mission */
  suggestedActions?: string[]
  relatedJobs?:      string[]
  relatedCompanies?: string[]
  generatedAt:       string
}

export type ApexMissionStore = {
  /** ISO date string YYYY-MM-DD — used for daily expiry */
  date:          string
  missions:      ApexMission[]
  /** Brief momentum line, e.g. "You've been applying consistently this week." */
  momentumLine?: string
  /** When true, user has disabled missions for this session */
  disabled:      boolean
}
