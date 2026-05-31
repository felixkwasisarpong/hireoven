/**
 * Apex Multi-Agent Architecture — Shared Types V1
 *
 * Agents are deterministic computation units. They:
 *   - receive a structured ApexExecutionContext
 *   - return a structured AgentResult
 *   - NEVER render UI directly
 *   - NEVER make autonomous LLM calls (unless explicitly configured)
 *   - run in parallel when safe
 *
 * The single Anthropic call stays in the chat route.
 * Agents enrich the context Claude receives.
 */

import type { Pool } from "pg"
import type {
  ApexMode,
  ApexAction,
  ApexWorkspaceDirective,
  ApexWorkflowDirective,
} from "@/lib/apex/types"
import type { CompareJobContext } from "@/lib/apex/context"

// ── Intent (derived from user message + regexes, no LLM needed) ──────────────

export type AgentIntent =
  | "search"        // filter feed, find jobs
  | "compare"       // rank/compare saved jobs
  | "tailor"        // tailor resume, cover letter
  | "workflow"      // prepare application workflow
  | "company"       // company intelligence query
  | "market"        // market signal analysis
  | "opportunity"   // related jobs / skill unlock
  | "autofill"      // autofill readiness
  | "interview"     // interview prep
  | "general"       // catch-all / conversational

// ── Shared execution context passed to every agent ───────────────────────────

export type ApexExecutionContext = {
  userId:        string
  message:       string
  detectedIntent: AgentIntent

  pool:          Pool

  /** IDs from the current request */
  jobId?:        string
  companyId?:    string
  resumeId?:     string

  /** Resolved from getApexContext() — read-only, agents do not re-fetch */
  resume?: {
    id:            string
    topSkills:     string[] | null
    skills:        Record<string, string[]> | null
    seniorityLevel: string | null
    summary?:      string | null
  }
  company?: {
    id:              string
    name:            string
    industry:        string | null
    size:            string | null
    sponsorsH1b:     boolean
    sponsorshipConf: number
    immigrationProfile: unknown
    hiringHealth:    unknown
  }
  job?: {
    id:          string
    title:       string
    companyName: string
    skills:      string[] | null
    description: string | null
    sponsorsH1b: boolean | null
  }
  compareJobs?: CompareJobContext[]

  /** From behavior signals */
  preferredRoles?: string[]
  userSkills?:     string[]
  sponsorshipRequired?: boolean
}

// ── Agent result ──────────────────────────────────────────────────────────────

export type AgentResult<T = Record<string, unknown>> = {
  agentId:     string
  success:     boolean
  data?:       T
  /**
   * Plain text block appended to Claude's context prompt.
   * Keep tight: max ~300 tokens per agent.
   */
  contextSection?: string
  durationMs:  number
  error?:      string
}

// ── Base agent interface ──────────────────────────────────────────────────────

export interface ApexAgent<T = Record<string, unknown>> {
  readonly id: string
  /** Intents this agent is relevant for (empty = runs for all) */
  readonly relevantIntents: AgentIntent[]
  run(ctx: ApexExecutionContext): Promise<AgentResult<T>>
}

// ── Orchestrator result ───────────────────────────────────────────────────────

export type AgentTrace = {
  agentId:    string
  durationMs: number
  success:    boolean
  /** Brief one-line summary of what was found */
  summary?:   string
  error?:     string
}

export type OrchestratorResult = {
  /**
   * Text sections injected into Claude's context prompt.
   * Each section is clearly labelled and self-contained.
   */
  contextSections:  string[]
  /**
   * Structured enrichments for workspace directives, compare fallback, etc.
   * Keyed by agentId.
   */
  enrichments:      Partial<OrchestratorEnrichments>
  /** Dev-only execution trace */
  traces?:          AgentTrace[]
  totalDurationMs:  number
}

export type OrchestratorEnrichments = {
  market:    import("@/lib/apex/market-intelligence").MarketSignal[]
  company:   import("@/lib/apex/company-intel/types").CompanyIntelSummary
  resume:    { missingKeywords: string[]; matchScore: number | null }
  compare:   CompareJobContext[]
  opportunity: import("@/lib/apex/opportunity-graph/types").OpportunityRecommendation[]
}
