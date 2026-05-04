import type { JobMatchScore } from "@/types"

type MatchScoreLike =
  | Pick<JobMatchScore, "overall_score">
  | { overall_score?: unknown }
  | null
  | undefined

type RawRecord = Record<string, unknown>

const RAW_SCORE_KEYS = ["matchScore", "match_score"] as const

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function normalizeMatchScore(value: unknown): number | null {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return null
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function readRawMatchScore(rawData: unknown): number | null {
  if (!rawData || typeof rawData !== "object") return null
  const raw = rawData as RawRecord

  for (const key of RAW_SCORE_KEYS) {
    const value = raw[key]
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const fromOverallScore = normalizeMatchScore((value as RawRecord).overall_score)
      if (fromOverallScore !== null) return fromOverallScore
      const fromOverallScoreCamel = normalizeMatchScore((value as RawRecord).overallScore)
      if (fromOverallScoreCamel !== null) return fromOverallScoreCamel
    }

    const direct = normalizeMatchScore(value)
    if (direct !== null) return direct
  }

  return null
}

export function resolveOverallMatchScore({
  preferredScore,
  fallbackScore,
  analysisOverallScore,
  rawData,
}: {
  preferredScore?: MatchScoreLike
  fallbackScore?: MatchScoreLike
  analysisOverallScore?: unknown
  rawData?: unknown
}): number | null {
  const analysisScore = normalizeMatchScore(analysisOverallScore)
  if (analysisScore !== null) return analysisScore

  const preferred = normalizeMatchScore(preferredScore?.overall_score)
  if (preferred !== null) return preferred

  const fallback = normalizeMatchScore(fallbackScore?.overall_score)
  if (fallback !== null) return fallback

  return readRawMatchScore(rawData)
}

export type MatchTier = "excellent" | "strong" | "moderate" | "low" | "unavailable"

export function getMatchTier(score: number | null): MatchTier {
  if (score === null) return "unavailable"
  if (score >= 85) return "excellent"
  if (score >= 70) return "strong"
  if (score >= 55) return "moderate"
  return "low"
}

export function getMatchCardLabel(score: number | null): string {
  const tier = getMatchTier(score)
  if (tier === "unavailable") return "Match unavailable"
  if (tier === "excellent") return "Excellent"
  if (tier === "strong") return "Strong"
  if (tier === "moderate") return "Moderate"
  return "Low"
}

export function getMatchVerdict(score: number | null): { label: string; colorClass: string } {
  const tier = getMatchTier(score)
  if (tier === "unavailable") return { label: "No score yet", colorClass: "text-slate-400" }
  if (tier === "excellent") return { label: "Excellent match", colorClass: "text-emerald-600" }
  if (tier === "strong") return { label: "Strong match", colorClass: "text-emerald-500" }
  if (tier === "moderate") return { label: "Moderate match", colorClass: "text-orange-500" }
  return { label: "Low match", colorClass: "text-slate-400" }
}
