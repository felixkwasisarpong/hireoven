// ── Offer negotiation types ────────────────────────────────────────────────────

export type SalaryBenchmark = {
  offered: number | null
  marketP25: number
  marketP50: number
  marketP75: number
  marketP90: number
  lcaPrevailingWage: number | null
  percentilePosition: string
  isBelowMarket: boolean
  negotiableUpTo: number
  source: string
  locationType: string
}

export type ComponentNegotiationPotential = "high" | "medium" | "low" | "none"

export type ComponentAnalysisItem = {
  component: "base" | "signing" | "bonus" | "equity" | "pto" | "vesting"
  offeredValue: string
  marketBenchmark: string
  isNegotiable: boolean
  negotiationPotential: ComponentNegotiationPotential
  talkingPoint: string
}

export type NegotiationStrategy = {
  recommendedApproach: string
  priorityComponents: string[]
  estimatedUpside: number
  riskLevel: "low" | "medium" | "high"
}

export type CounterOfferScript = {
  openingLine: string
  salaryAsk: number
  justification: string
  fallbackPosition: number
  fullScript: string
}

export type NegotiationAnalysis = {
  overallScore: number
  salaryAnalysis: SalaryBenchmark
  componentAnalysis: ComponentAnalysisItem[]
  negotiationStrategy: NegotiationStrategy
  counterOfferScript: CounterOfferScript
  redFlags: string[]
  immigrationConsiderations: string[]
}

export type CounterOfferFallback = {
  ask: number
  justification: string
}

export type CounterOfferPackage = {
  emailScript: string
  verbalScript: string
  fallbackPositions: CounterOfferFallback[]
  doNotSayList: string[]
  bestTimeToNegotiate: string
  estimatedSuccessRate: string
}

export type NegotiationTimelineStep = {
  day: string
  action: string
  script: string | null
  isAutomatic: boolean
}

export type NegotiationTimeline = {
  deadline: string | null
  daysRemaining: number | null
  steps: NegotiationTimelineStep[]
  urgencyLevel: "low" | "medium" | "high"
}

// Input types for the negotiation analysis
export type OfferDetails = {
  base_salary?: number
  equity?: string
  signing_bonus?: number
  annual_bonus_target?: number
  benefits_notes?: string
  offer_deadline?: string
}

export type NegotiationUserProfile = {
  visaStatus?: string | null
  needsSponsorship?: boolean
  yearsExperience?: number | null
  location?: string | null
  topSkills?: string[]
  desiredSeniority?: string[]
}
