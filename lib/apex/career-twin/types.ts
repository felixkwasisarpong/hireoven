import type { RoleCategory, JobSector } from "@/lib/apex/outcomes/categorizers"

export type CareerTwinDimensionCategory =
  | "fit"
  | "momentum"
  | "readiness"
  | "constraint"
  | "risk"
  | "focus"

export type CareerTwinDimensionDirection = "strength" | "risk" | "constraint" | "neutral"

export type CareerTwinDimension = {
  key: string
  label: string
  category: CareerTwinDimensionCategory
  direction: CareerTwinDimensionDirection
  score: number
  confidence: number
  evidence: string[]
  updatedAt: string
}

export type CareerTwinSnapshot = {
  id: string
  userId: string
  version: number
  headline: string
  summary: string
  strengths: string[]
  risks: string[]
  constraints: string[]
  recommendedFocus: string[]
  primaryRoleCategory: RoleCategory | null
  primarySector: JobSector | null
  preferredWorkModes: Array<"remote" | "hybrid" | "onsite">
  confidence: number
  freshnessScore: number
  evidenceCount: number
  dimensions: CareerTwinDimension[]
  generatedAt: string
}

export type CareerTwinBuildReason =
  | "manual_refresh"
  | "strategy_request"
  | "api_read_through"
  | "background_refresh"

export type BuildCareerTwinInput = {
  headline: string
  summary: string
  strengths: string[]
  risks: string[]
  constraints: string[]
  recommendedFocus: string[]
  primaryRoleCategory: RoleCategory | null
  primarySector: JobSector | null
  preferredWorkModes: Array<"remote" | "hybrid" | "onsite">
  confidence: number
  freshnessScore: number
  evidenceCount: number
  dimensions: CareerTwinDimension[]
  reason: CareerTwinBuildReason
  sourceStats?: Record<string, number | string | boolean | null>
}
