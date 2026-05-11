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

/**
 * Default: "off". AI enrichment is opt-in via env var only — the system
 * runs deterministic-only normalization out of the box (no Anthropic
 * spend on background crawls). To enable a Haiku-backed enrichment pass
 * once you have AI budget, set CRAWLER_AI_ENRICHMENT_MODE=async (queues
 * jobs for the /api/crawl/enrichment cron) or =sync (enriches inline at
 * crawl time — careful, expensive).
 */
export function getCrawlerAiEnrichmentMode(): CrawlerAiEnrichmentMode {
  const mode = (process.env.CRAWLER_AI_ENRICHMENT_MODE ?? "off").trim().toLowerCase()
  if (mode === "sync" || mode === "async" || mode === "off") return mode
  return "off"
}

export function shouldAttemptAiEnrichment(normalization: NormalizationResult): boolean {
  const validation = normalization.canonical.validation
  if (validation.requires_review) return true
  if (validation.confidence_score < AI_ENRICHMENT_MIN_CONFIDENCE_SCORE) return true
  if (validation.completeness_score < AI_ENRICHMENT_MIN_COMPLETENESS_SCORE) return true
  return false
}
