import type { NormalizationResult } from "@/lib/jobs/normalization"

export type CrawlerAiEnrichmentMode = "sync" | "async" | "off"

function clampScore(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw ?? "")
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(1, parsed))
}

const AI_ENRICHMENT_MIN_CONFIDENCE_SCORE = clampScore(
  process.env.CRAWLER_AI_ENRICHMENT_MIN_CONFIDENCE_SCORE,
  0.86
)

const AI_ENRICHMENT_MIN_COMPLETENESS_SCORE = clampScore(
  process.env.CRAWLER_AI_ENRICHMENT_MIN_COMPLETENESS_SCORE,
  0.78
)

export function getCrawlerAiEnrichmentMode(): CrawlerAiEnrichmentMode {
  const mode = (process.env.CRAWLER_AI_ENRICHMENT_MODE ?? "async").trim().toLowerCase()
  if (mode === "sync" || mode === "async" || mode === "off") return mode
  return "async"
}

export function shouldAttemptAiEnrichment(normalization: NormalizationResult): boolean {
  const validation = normalization.canonical.validation
  if (validation.requires_review) return true
  if (validation.confidence_score < AI_ENRICHMENT_MIN_CONFIDENCE_SCORE) return true
  if (validation.completeness_score < AI_ENRICHMENT_MIN_COMPLETENESS_SCORE) return true
  return false
}
