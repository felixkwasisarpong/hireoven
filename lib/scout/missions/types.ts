/**
 * Scout Daily Mission System — Types
 *
 * Missions are daily focus priorities, not gamification.
 * Tone: calm, strategic, assistant-like. Never shame or fake urgency.
 */

export type ScoutMissionType =
  | "applications"
  | "resume"
  | "compare"
  | "interview"
  | "market_research"
  | "follow_up"

export type ScoutMissionPriority = "low" | "medium" | "high"

export type ScoutMissionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "dismissed"

export type ScoutMission = {
  id:                string
  type:              ScoutMissionType
  title:             string
  summary:           string
  priority:          ScoutMissionPriority
  status:            ScoutMissionStatus
  /** The Scout command bar query to run when user clicks the mission */
  suggestedActions?: string[]
  relatedJobs?:      string[]
  relatedCompanies?: string[]
  generatedAt:       string
}

export type ScoutMissionStore = {
  /** ISO date string YYYY-MM-DD — used for daily expiry */
  date:          string
  missions:      ScoutMission[]
  /** Brief momentum line, e.g. "You've been applying consistently this week." */
  momentumLine?: string
  /** When true, user has disabled missions for this session */
  disabled:      boolean
}
