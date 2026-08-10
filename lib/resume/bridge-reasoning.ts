/**
 * AI reasoning layer over a computed career bridge.
 *
 * `computeBridgePath` (lib/resume/bridge) already produces the HARD facts:
 * transferable skills, gaps to build, overlap %, current target fit, and REAL
 * live bridge roles pulled from the job index. This layer asks Claude to reason
 * *over those facts* — turning them into an ordered, honest pivot plan — WITHOUT
 * inventing anything.
 *
 * Hard grounding contract:
 *   - Claude may only reference skills, roles, counts, and percentages that
 *     appear in the provided BridgePath. It is told, explicitly, not to invent
 *     statistics, timelines, company names, or salary figures.
 *   - When real transition evidence is available (PivotEvidence from the graph),
 *     it is passed in as FACTS.pastMoves and Claude may cite it ("N people we've
 *     tracked made this move"). Absent that, the model is told to reference no
 *     prior movers or timelines at all — the evidence is never fabricated.
 *   - If the model is unavailable, the budget cap is tripped, or it times out,
 *     `deterministicReasoning()` returns a plan assembled straight from the same
 *     facts — so the user always gets an honest answer, never a fabricated one.
 *
 * Server-only (uses the Anthropic client + budget tracker).
 */

import type Anthropic from "@anthropic-ai/sdk"
import type { BridgePath } from "@/lib/resume/bridge"
import type { PivotEvidence } from "@/lib/career/pivot-evidence"
import { ANTHROPIC_MODEL_ROUTING } from "@/lib/ai/anthropic-models"
import { withAICall } from "@/lib/apex/budget/ai-call"
import { AI_TIMEOUTS } from "@/lib/apex/budget/router"

export interface BridgeStep {
  title: string
  detail: string
}

export interface BridgeReasoning {
  /** Honest one/two-line read of the pivot: how far, and the core lever. */
  summary: string
  /** Ordered concrete moves, each grounded in the computed facts. */
  steps: BridgeStep[]
  /** How to frame the resume for the target field. */
  positioning: string
  /** Honest caveats — long bridge, thin bridge-role supply, etc. */
  risks: string[]
  /** The single most concrete next action. */
  firstMove: string
  /** Where this came from — 'ai' reasoned it, 'fallback' assembled it deterministically. */
  source: "ai" | "fallback"
}

const MODEL = ANTHROPIC_MODEL_ROUTING.CAREER_BRIDGE_REASONING
const MAX_LIST = 8

const SYSTEM_PROMPT = `You are a career-pivot strategist for HireOven. You are given a FACTS object describing a move from one professional field to another. Every skill, role title, count, and percentage in FACTS was computed from a real résumé and a live US job index — they are ground truth.

Your job: reason over FACTS to produce a practical, honest pivot plan.

Hard rules — non-negotiable:
- Use ONLY the skills, role titles, counts, and percentages present in FACTS. Do NOT invent skills, companies, salary figures, timelines ("takes 3 months"), success rates, or job counts. If FACTS does not contain a number, do not state one.
- When FACTS.bridgeRoles is empty, say plainly that no roles currently bridge these two fields and that the move is a longer one — do not imply roles exist.
- Be specific and grounded: reference the actual transferable skills, the actual gap skills, and the actual bridge-role titles by name.
- Reflect the difficulty honestly. Low overlapPct or targetFit means a hard pivot; say so.
- Reflect sponsorship density only if sponsorshipShare is present, and describe it as the share of these roles at sponsoring employers — nothing more.
- If FACTS.pastMoves is present, it is real: the number of people HireOven has actually tracked making this exact move, and (when given) the median months it took them. You MAY cite it as encouragement and grounding. Describe it exactly — "N people we've tracked made this move" — and only mention a duration if medianMonths is present. If FACTS.pastMoves is absent, do NOT reference any prior movers or timelines at all.

Return ONLY a JSON object, no prose around it, matching exactly:
{
  "summary": string,            // 1-2 sentences: how far the pivot is and the core lever
  "steps": [{"title": string, "detail": string}],  // 3-5 ordered moves
  "positioning": string,        // how to frame the resume for the target field
  "risks": [string],            // 1-3 honest caveats
  "firstMove": string           // the single most concrete next action
}`

function factsFor(bridge: BridgePath, evidence?: PivotEvidence | null): string {
  return JSON.stringify(
    {
      from: bridge.fromLabel,
      to: bridge.toLabel,
      overlapPct: bridge.overlapPct,
      targetFit: bridge.targetFit,
      transferable: bridge.transferable.slice(0, MAX_LIST),
      toBuild: bridge.toBuild.slice(0, MAX_LIST),
      bridgeRoles: bridge.bridgeRoles.slice(0, MAX_LIST).map((r) => ({
        title: r.title,
        openRoles: r.count,
        sponsorSharePct: Math.round(r.sponsorshipShare * 100),
      })),
      sponsorshipSharePct:
        typeof bridge.sponsorshipShare === "number" ? Math.round(bridge.sponsorshipShare * 100) : null,
      // Only included once the transition graph holds enough real moves to say
      // anything honest — absent otherwise, so the model can't cite prior movers.
      pastMoves: evidence
        ? { people: evidence.sampleSize, medianMonths: evidence.medianGapMonths }
        : undefined,
    },
    null,
    2,
  )
}

const STR = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const STR_ARR = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(STR).filter(Boolean).slice(0, 5) : []

function parseReasoning(text: string): BridgeReasoning | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let raw: unknown
  try {
    raw = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>

  const steps: BridgeStep[] = Array.isArray(o.steps)
    ? o.steps
        .map((s) => {
          const so = (s ?? {}) as Record<string, unknown>
          return { title: STR(so.title), detail: STR(so.detail) }
        })
        .filter((s) => s.title || s.detail)
        .slice(0, 5)
    : []

  const summary = STR(o.summary)
  const firstMove = STR(o.firstMove)
  // A response with no summary and no steps is unusable — fall back.
  if (!summary && steps.length === 0) return null

  return {
    summary,
    steps,
    positioning: STR(o.positioning),
    risks: STR_ARR(o.risks),
    firstMove,
    source: "ai",
  }
}

/**
 * Assemble an honest plan directly from the computed facts — no LLM. Used as the
 * fallback so the feature degrades to grounded-but-plain rather than to nothing.
 */
export function deterministicReasoning(bridge: BridgePath, evidence?: PivotEvidence | null): BridgeReasoning {
  const distance =
    bridge.overlapPct >= 45 ? "a short bridge" : bridge.overlapPct >= 25 ? "a moderate bridge" : "a longer pivot"
  const transfer = bridge.transferable.slice(0, 4)
  const build = bridge.toBuild.slice(0, 4)
  const topRoles = bridge.bridgeRoles.slice(0, 3)

  const steps: BridgeStep[] = []
  if (topRoles.length > 0) {
    steps.push({
      title: "Target the roles that already bridge both fields",
      detail: `${topRoles
        .map((r) => `${r.title} (${r.count} open)`)
        .join(", ")} ask for both ${bridge.fromLabel} and ${bridge.toLabel} — the realistic stepping stones.`,
    })
  }
  if (transfer.length > 0) {
    steps.push({
      title: "Lead with what carries over",
      detail: `${bridge.toLabel} demand rewards ${transfer.join(", ")}, and your resume already shows these — put them up front.`,
    })
  }
  if (build.length > 0) {
    steps.push({
      title: "Close the gap deliberately",
      detail: `The most in-demand ${bridge.toLabel} skills your resume doesn't show yet: ${build.join(", ")}. Build and evidence these first.`,
    })
  }

  const risks: string[] = []
  if (bridge.overlapPct < 25) {
    risks.push(`Only ${bridge.overlapPct}% of what these two fields demand overlaps — expect this to take real reskilling.`)
  }
  if (bridge.bridgeRoles.length === 0) {
    risks.push(`No live roles currently ask for both ${bridge.fromLabel} and ${bridge.toLabel} — a sign it's a longer move.`)
  }

  const firstMove =
    topRoles.length > 0
      ? `Open the "${topRoles[0]!.title}" postings and map your ${transfer[0] ?? "closest"} experience onto their requirements.`
      : build.length > 0
        ? `Start building ${build[0]}, the highest-leverage ${bridge.toLabel} skill you're missing.`
        : `Sharpen how your resume frames ${transfer[0] ?? "your strongest skill"} toward ${bridge.toLabel}.`

  // Only cite prior movers when the graph actually holds them.
  const evidenceSentence = evidence
    ? ` ${evidence.sampleSize} people we've tracked have made this move${
        evidence.medianGapMonths !== null
          ? `, typically over about ${evidence.medianGapMonths} month${evidence.medianGapMonths === 1 ? "" : "s"}`
          : ""
      }.`
    : ""

  return {
    summary: `Moving from ${bridge.fromLabel} to ${bridge.toLabel} is ${distance}: your resume already reads at ${bridge.targetFit}% of ${bridge.toLabel} demand.${evidenceSentence}`,
    steps,
    positioning:
      transfer.length > 0
        ? `Reframe your ${bridge.fromLabel} experience around ${transfer.join(", ")} — the skills ${bridge.toLabel} employers are actually screening for.`
        : `Rewrite your summary to speak in ${bridge.toLabel} terms rather than ${bridge.fromLabel} ones.`,
    risks,
    firstMove,
    source: "fallback",
  }
}

/**
 * Reason over a computed bridge with Claude, grounded strictly in its facts.
 * Falls back to `deterministicReasoning` on budget cap, timeout, or parse failure.
 */
export async function reasonOverBridge(
  anthropic: Anthropic,
  bridge: BridgePath,
  evidence?: PivotEvidence | null,
  userId?: string,
): Promise<BridgeReasoning> {
  const { value } = await withAICall<BridgeReasoning | null>({
    anthropic,
    feature: "resume_bridge_reasoning",
    timeoutMs: AI_TIMEOUTS.resume_bridge_reasoning,
    params: {
      model: MODEL,
      max_tokens: 1200,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `FACTS:\n${factsFor(bridge, evidence)}` }],
    },
    parse: parseReasoning,
    fallback: () => null,
    userId,
  })

  return value ?? deterministicReasoning(bridge, evidence)
}
