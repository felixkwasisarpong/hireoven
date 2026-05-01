export type ScoutFeature =
  | "scout_chat"
  | "scout_chat_stream"
  | "scout_strategy"
  | "scout_research"
  | "scout_follow_up"
  | "scout_mock_interview"
  | "scout_bulk_prepare"
  | "scout_career"
  | "scout_memory_extract"
  | "resume_generate"
  | "resume_ai_write"
  | "resume_tailor_analyze"
  | "cover_letter"
  | "cover_letter_extension"
  | "interview_prep"
  | "autofill_improve"
  | "job_normalization"

export type ModelTier = "haiku" | "sonnet" | "opus"

export type BudgetEntry = {
  feature: ScoutFeature
  model: string
  tier: ModelTier
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costUsd: number
  success: boolean
  cached: boolean
  timedOut: boolean
  userId?: string
  timestamp: number
}

export type BudgetStats = {
  totalCalls: number
  cachedCalls: number
  timedOutCalls: number
  failedCalls: number
  cacheHitRate: number
  totalCostUsd: number
  avgLatencyMs: number
  p95LatencyMs: number
  byFeature: Record<string, FeatureStats>
}

export type FeatureStats = {
  calls: number
  cachedCalls: number
  timedOutCalls: number
  failedCalls: number
  totalCostUsd: number
  avgLatencyMs: number
  totalInputTokens: number
  totalOutputTokens: number
}

export type ScoutCacheStats = {
  size: number
  maxSize: number
  hits: number
  misses: number
  hitRate: number
}

// Deterministic routing — no LLM needed for these
export type RoutingDecision =
  | { useLLM: false; reason: string; deterministicResult?: string }
  | { useLLM: true; reason?: string }
