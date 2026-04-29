import type { ApplicationStatus, JobApplication, TimelineEntry } from "@/types"

export type FollowUpStatus = "ready" | "not_needed" | "missing_context"
export type FollowUpUrgency = "low" | "medium" | "high"

export type FollowUpAnalysis = {
  status: FollowUpStatus
  recommendation: string
  reasons: string[]
  daysStale: number | null
  urgency: FollowUpUrgency | null
}

// Statuses where a follow-up genuinely doesn't apply
const TERMINAL_STATUSES = new Set<ApplicationStatus>([
  "saved",
  "rejected",
  "withdrawn",
  "offer",
])

const TERMINAL_MESSAGES: Partial<Record<ApplicationStatus, string>> = {
  saved: "You haven't applied yet — follow up after submitting.",
  rejected: "This application was closed. No follow-up needed.",
  withdrawn: "You withdrew from this application.",
  offer: "You have an offer! No follow-up needed.",
}

// Minimum days before follow-up makes sense per status
const FOLLOW_UP_THRESHOLD: Partial<Record<ApplicationStatus, number>> = {
  applied: 7,
  phone_screen: 5,
  interview: 3,
  final_round: 3,
}

// Days after which urgency escalates
const URGENCY_HIGH_THRESHOLD: Partial<Record<ApplicationStatus, number>> = {
  applied: 21,
  phone_screen: 10,
  interview: 7,
  final_round: 5,
}

const URGENCY_MEDIUM_THRESHOLD: Partial<Record<ApplicationStatus, number>> = {
  applied: 14,
  phone_screen: 7,
  interview: 5,
  final_round: 4,
}

function getLastActivityDate(app: JobApplication): Date | null {
  const dates: Date[] = []

  if (app.applied_at) dates.push(new Date(app.applied_at))

  if (Array.isArray(app.timeline)) {
    for (const entry of app.timeline as TimelineEntry[]) {
      if (entry.date) dates.push(new Date(entry.date))
    }
  }

  if (dates.length === 0) return null
  return new Date(Math.max(...dates.map((d) => d.getTime())))
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000)
}

function pluralDays(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`
}

function computeUrgency(
  status: ApplicationStatus,
  days: number
): FollowUpUrgency {
  const high = URGENCY_HIGH_THRESHOLD[status] ?? 21
  const medium = URGENCY_MEDIUM_THRESHOLD[status] ?? 14
  if (days >= high) return "high"
  if (days >= medium) return "medium"
  return "low"
}

export function analyzeFollowUp(app: JobApplication): FollowUpAnalysis {
  const { status } = app

  if (TERMINAL_STATUSES.has(status)) {
    return {
      status: "not_needed",
      recommendation: TERMINAL_MESSAGES[status] ?? "No follow-up needed.",
      reasons: [],
      daysStale: null,
      urgency: null,
    }
  }

  const lastActivity = getLastActivityDate(app)

  if (!lastActivity) {
    return {
      status: "missing_context",
      recommendation: "Add your application date to get follow-up timing advice.",
      reasons: ["No application date on record."],
      daysStale: null,
      urgency: null,
    }
  }

  const days = daysSince(lastActivity)
  const threshold = FOLLOW_UP_THRESHOLD[status] ?? 7

  if (days < threshold) {
    const wait = threshold - days
    return {
      status: "not_needed",
      recommendation: `It's been ${pluralDays(days)} — wait ${pluralDays(wait)} before following up.`,
      reasons: [`${pluralDays(days)} since last activity. Recruiters typically need ${threshold}+ days to respond.`],
      daysStale: days,
      urgency: null,
    }
  }

  const urgency = computeUrgency(status, days)

  const statusMessages: Partial<Record<ApplicationStatus, string>> = {
    applied: `It's been ${pluralDays(days)} since you applied — a good time to follow up.`,
    phone_screen: `It's been ${pluralDays(days)} since your phone screen — following up shows continued interest.`,
    interview: `It's been ${pluralDays(days)} since your interview — a polite follow-up is appropriate.`,
    final_round: `It's been ${pluralDays(days)} since your final round — check in on next steps.`,
  }

  const statusReasons: Partial<Record<ApplicationStatus, string[]>> = {
    applied: [
      `Applied ${pluralDays(days)} ago with no response.`,
      urgency === "high"
        ? "Applications with no response after 3 weeks often need re-engagement."
        : "7–14 days after applying is the optimal follow-up window.",
    ],
    phone_screen: [
      `${pluralDays(days)} since your phone screen with no update.`,
      "Following up after a screen reinforces your enthusiasm for the role.",
    ],
    interview: [
      `${pluralDays(days)} since your interview with no update.`,
      "Candidates who follow up after interviews signal strong interest.",
    ],
    final_round: [
      `${pluralDays(days)} since your final round — you deserve an update.`,
      "Politely asking for a timeline is expected at this stage.",
    ],
  }

  return {
    status: "ready",
    recommendation: statusMessages[status] ?? `It's been ${pluralDays(days)} — consider following up.`,
    reasons: statusReasons[status] ?? [`${pluralDays(days)} since last activity.`],
    daysStale: days,
    urgency,
  }
}

/** Returns the urgency color classes for the badge. */
export function urgencyMeta(urgency: FollowUpUrgency | null): {
  badge: string
  label: string
} {
  if (urgency === "high") return { badge: "bg-red-50 text-red-700 border-red-200", label: "Urgent" }
  if (urgency === "medium") return { badge: "bg-amber-50 text-amber-700 border-amber-200", label: "Follow up" }
  return { badge: "bg-blue-50 text-blue-700 border-blue-200", label: "Follow up" }
}
