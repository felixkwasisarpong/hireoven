export type ApexHuntPosture = "narrow" | "balanced" | "aggressive"
export type ApexHuntUrgency = "now" | "today" | "watch"

export type ApexHuntAction = {
  id: string
  title: string
  why: string
  query: string
  urgency: ApexHuntUrgency
}

export type ApexHuntTrack = {
  id: string
  title: string
  thesis: string
  reason: string
  query: string
  posture: "primary" | "secondary" | "watch"
}

export type ApexHuntQueueItem = {
  id: string
  jobId: string
  title: string
  companyId: string | null
  companyName: string
  location: string | null
  workMode: "remote" | "hybrid" | "onsite"
  matchScore: number | null
  sponsorshipScore: number
  freshnessHours: number
  queueScore: number
  reason: string
  feedQuery: string
  jobHref: string
  companyHref: string | null
}

export type ApexAutonomousHuntSignals = {
  sponsorshipRequired: boolean
  targetLane: string | null
  preferredLocation: string | null
  recentApplications: number
  activeApplications: number
  savedJobs: number
  executionRunCount7d: number
  executionDeferredCount7d: number
  executionDoneCount7d: number
  topQueueScore: number | null
  freshSponsorCount: number
}

export type ApexAutonomousHuntPlan = {
  generatedAt: string
  posture: ApexHuntPosture
  summary: string
  operatingRule: string
  targetLane: string | null
  whyNow: string[]
  attackPlan: ApexHuntAction[]
  queue: ApexHuntQueueItem[]
  tracks: ApexHuntTrack[]
  guardrails: string[]
  signals: ApexAutonomousHuntSignals
}
