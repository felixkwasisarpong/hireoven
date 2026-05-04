/**
 * Scout Orchestrator V1
 *
 * Routes an incoming user intent to the appropriate specialized agents,
 * runs them in parallel (where safe), and merges their outputs into:
 *   - contextSections: text blocks injected into Claude's prompt
 *   - enrichments:     structured data for workspace directives / compare fallback
 *   - traces:          dev-only execution log
 *
 * The user experiences one Scout. The orchestrator is invisible.
 *
 * Design rules:
 *   - No LLM calls in this layer (Claude is called once, in the chat route)
 *   - Agents are deterministic computation or fast DB reads
 *   - All agent failures are silent (degrade gracefully, never block)
 *   - Parallelism: all selected agents run concurrently
 *   - Budget: total orchestration target < 300ms for cached/fast agents
 */

import type {
  ScoutAgent,
  ScoutExecutionContext,
  AgentIntent,
  AgentResult,
  AgentTrace,
  OrchestratorResult,
} from "./types"
import { MarketIntelAgent }  from "./market-intel-agent"
import { CompanyIntelAgent } from "./company-intel-agent"
import { ResumeAgent }       from "./resume-agent"
import { OpportunityAgent }  from "./opportunity-agent"

const IS_DEV = process.env.NODE_ENV === "development"

// ── Agent registry ────────────────────────────────────────────────────────────

const AGENTS: ScoutAgent[] = [
  new MarketIntelAgent(),
  new CompanyIntelAgent(),
  new ResumeAgent(),
  new OpportunityAgent(),
]

// ── Intent → agent routing ────────────────────────────────────────────────────

const INTENT_AGENTS: Record<AgentIntent, string[]> = {
  search:     ["market"],
  compare:    ["market", "company"],
  tailor:     ["resume", "company"],
  workflow:   ["resume", "company"],
  company:    ["company"],
  market:     ["market"],
  opportunity:["opportunity", "market"],
  autofill:   [],
  interview:  ["resume"],
  general:    [],
}

/** Detect AgentIntent from the same regexes used in the chat route. */
export function detectAgentIntent(message: string): AgentIntent {
  const m = message.trim().toLowerCase()
  if (/\b(compare|rank.*job|which.*apply|side.?by.?side)\b/.test(m)) return "compare"
  if (/\b(tailor|tailor.?my.?resume|tailor.*for)\b/.test(m))          return "tailor"
  if (/\b(prepare.*application|workflow|application.*workflow)\b/.test(m)) return "workflow"
  if (/\b(company|employer|sponsor|does.*hire)\b/.test(m))            return "company"
  if (/\b(market|trend|hiring.?rate|demand)\b/.test(m))               return "market"
  if (/\b(similar.?job|adjacent|related.*role|skill.?unlock)\b/.test(m)) return "opportunity"
  if (/\b(autofill|fill.*form|form.?field)\b/.test(m))                return "autofill"
  if (/\b(interview|prep|practice.?question)\b/.test(m))              return "interview"
  if (/\b(find|search|show|filter|discover)\b.{0,40}\bjob[s]?\b/.test(m)) return "search"
  return "general"
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function runOrchestrator(
  ctx: ScoutExecutionContext
): Promise<OrchestratorResult> {
  const start = Date.now()

  // Select agents for this intent
  const activeIds = INTENT_AGENTS[ctx.detectedIntent] ?? []
  if (activeIds.length === 0) {
    return { contextSections: [], enrichments: {}, totalDurationMs: 0 }
  }

  const selected = AGENTS.filter((a) => activeIds.includes(a.id))
  if (selected.length === 0) {
    return { contextSections: [], enrichments: {}, totalDurationMs: 0 }
  }

  // Run all selected agents in parallel — failures are silently discarded
  const settled = await Promise.allSettled(
    selected.map((agent) => agent.run(ctx))
  )

  const contextSections: string[] = []
  const enrichments: OrchestratorResult["enrichments"] = {}
  const traces: AgentTrace[] = []

  for (const result of settled) {
    if (result.status === "rejected") {
      if (IS_DEV) {
        traces.push({ agentId: "unknown", durationMs: 0, success: false, error: String(result.reason) })
      }
      continue
    }

    const r = result.value as AgentResult
    if (r.contextSection) contextSections.push(r.contextSection)
    if (r.data && r.success) {
      enrichments[r.agentId as keyof OrchestratorResult["enrichments"]] = r.data as never
    }

    if (IS_DEV) {
      traces.push({
        agentId:    r.agentId,
        durationMs: r.durationMs,
        success:    r.success,
        summary:    r.success ? `${r.contextSection ? "context added" : "no context"} — ${r.durationMs}ms` : r.error,
        error:      r.error,
      })
    }
  }

  const total = Date.now() - start

  if (IS_DEV && traces.length > 0) {
    console.log("[scout:orchestrator]", {
      intent:     ctx.detectedIntent,
      agents:     traces.map((t) => `${t.agentId}(${t.durationMs}ms,${t.success ? "ok" : "fail"})`).join(" "),
      totalMs:    total,
      sections:   contextSections.length,
    })
  }

  return {
    contextSections,
    enrichments,
    traces: IS_DEV ? traces : undefined,
    totalDurationMs: total,
  }
}
