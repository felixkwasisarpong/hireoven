/**
 * Apex Proactive Companion Mode — Types V1
 *
 * Design goals:
 * - high-signal, actionable, calm suggestions
 * - transparent and user-controlled
 * - no hidden automation
 */

export type ApexProactiveEvent = {
  id: string

  type:
    | "new_match"
    | "market_shift"
    | "workflow_reminder"
    | "application_followup"
    | "skill_signal"
    | "sponsorship_signal"
    | "company_activity"
    | "interview_reminder"
    | "stale_saved_job"
    | "queue_ready"

  title: string
  summary: string

  severity:
    | "info"
    | "important"
    | "urgent"

  relatedJobId?: string
  relatedCompanyId?: string

  createdAt: string
  expiresAt?: string
}

export type ApexProactiveEventType = ApexProactiveEvent["type"]
export type ApexProactiveSeverity = ApexProactiveEvent["severity"]

export type ApexProactiveSettings = {
  enabled: boolean
  mutedTypes: ApexProactiveEventType[]
  /** Event IDs snoozed until a timestamp. */
  snoozedUntil: Record<string, string>
  /** Event IDs dismissed at timestamp (used for short-term dedupe). */
  dismissedAt: Record<string, string>
}

export type ApexProactiveStore = {
  v: 1
  events: ApexProactiveEvent[]
  settings: ApexProactiveSettings
  savedAt: number
}

// ── Server snapshot used for event generation ───────────────────────────────

export type ProactiveHighMatch = {
  jobId: string
  jobTitle: string
  companyId?: string
  companyName?: string
  matchScore: number
  sponsorsH1b: boolean
}

export type ProactiveStaleSavedJob = {
  applicationId: string
  jobId?: string
  jobTitle: string
  companyName: string
  daysOld: number
}

export type ProactiveFollowUpCandidate = {
  applicationId: string
  jobId?: string
  jobTitle: string
  companyName: string
  daysStale: number
  urgency: "low" | "medium" | "high"
}

export type ProactiveInterviewReminder = {
  applicationId: string
  jobId?: string
  companyId?: string
  jobTitle: string
  companyName: string
  roundName: string
  interviewDate: string
  hoursUntil: number
}

export type ProactiveCompanySpike = {
  companyId: string
  companyName: string
  freshRoleCount: number
}

export type ProactiveSkillGap = {
  skill: string
  demandCount: number
}

export type ApexProactiveSnapshot = {
  computedAt: string
  highMatches: ProactiveHighMatch[]
  sponsorshipFriendlyMatchCount: number
  staleSavedJobs: ProactiveStaleSavedJob[]
  followUpCandidates: ProactiveFollowUpCandidate[]
  interviewsSoon: ProactiveInterviewReminder[]
  companySpikes: ProactiveCompanySpike[]
  skillGaps: ProactiveSkillGap[]
}
