/**
 * AI narration over a computed resume review.
 *
 * `buildResumeReview` (lib/resume/review) already produced the HARD facts: which
 * findings fired, their evidence quoted from the user's own resume, their fix,
 * and the order they cost interviews in. This layer asks Claude to *narrate*
 * those facts — to supply the causal explanation and the walkthrough voice that
 * a bulleted card list cannot — without adding a single new claim.
 *
 * The distinction matters. A generic "AI resume reviewer" prompts a model with
 * the raw resume and hopes; it invents findings, flatters, and contradicts
 * itself between runs. Here the model never sees an open-ended task: the
 * findings are already decided deterministically, and the model's only job is to
 * explain the ones it was handed, in the order it was handed them.
 *
 * Hard grounding contract:
 *   - Claude may only discuss findings present in FACTS.findings. It may not add
 *     a finding, promote/demote one, invent a statistic, or guess at the user's
 *     immigration status, employer quality, or intent.
 *   - Every number it states must already appear in the finding's evidence.
 *   - If the model is unavailable, over budget, times out, or returns something
 *     unparseable, `deterministicNarrative()` renders the same findings straight
 *     from their own fields — so the walkthrough degrades to plain, never to
 *     empty and never to invented.
 *
 * Server-only (Anthropic client + budget tracker).
 */

import type Anthropic from "@anthropic-ai/sdk"
import { ANTHROPIC_MODEL_ROUTING } from "@/lib/ai/anthropic-models"
import { withAICall } from "@/lib/apex/budget/ai-call"
import { AI_TIMEOUTS } from "@/lib/apex/budget/router"
import type { ResumeFinding, ResumeReview } from "@/lib/resume/review"

export interface NarratedStep {
  /** Finding this narrates. Always one of the computed finding ids. */
  id: string
  /** The walkthrough voice: what we saw and why it costs interviews. */
  explanation: string
  /** The single concrete instruction for this step. */
  doThis: string
}

export interface ReviewNarrative {
  /** Direct answer to "why am I not getting interviews?", 2-4 sentences. */
  opening: string
  steps: NarratedStep[]
  /** The one thing to do first, across all findings. */
  firstMove: string
  source: "ai" | "fallback"
}

const MODEL = ANTHROPIC_MODEL_ROUTING.RESUME_REVIEW
const MAX_STEPS = 8

const SYSTEM_PROMPT = `You are a blunt, experienced technical recruiter reviewing a candidate's resume for HireOven. You are given a FACTS object containing a ranked list of findings already computed from the candidate's real resume and from a live US job index. Those findings are ground truth.

Your job: narrate the findings you were given, in the order you were given them, so the candidate understands WHY each one costs them interviews.

Hard rules — non-negotiable:
- Discuss ONLY the findings in FACTS.findings. Do not add findings, remove findings, reorder them, or merge them. Return exactly one step per finding, using its exact "id".
- Every number, percentage, skill name, job title, company name, and word count you state must already appear in that finding's evidence, observation, or title. If FACTS does not contain a number, do not state one.
- Never speculate about the candidate's immigration status, nationality, age, health, or family. When a finding concerns work authorization, address only what the resume does or does not SAY, and frame the consequence conditionally ("if you need sponsorship").
- Do not flatter and do not soften. If something is costing them interviews, say so plainly. Equally, do not catastrophize a minor finding — match your tone to the finding's severity.
- Explain the causal step, not just the defect. The candidate already knows their bullets are long; they do not know that length is why the achievement in the third clause never gets read.
- Write in second person, plain English, no jargon, no bullet characters inside the strings.
- "firstMove" must correspond to the highest-ranked finding in FACTS. Never invent a different priority.

Return ONLY a JSON object, no prose around it, matching exactly:
{
  "opening": string,     // 2-4 sentences answering "why am I not getting interviews?" using only FACTS
  "steps": [{"id": string, "explanation": string, "doThis": string}],
  "firstMove": string    // one sentence, the single highest-value action
}`

/** Only the fields the model is allowed to reason from. */
function factsFor(review: ResumeReview): string {
  return JSON.stringify(
    {
      readsAs: review.readsAs,
      blockers: review.blockers,
      majors: review.majors,
      findings: review.findings.slice(0, MAX_STEPS).map((f) => ({
        id: f.id,
        severity: f.severity,
        title: f.title,
        observation: f.observation,
        evidence: f.evidence,
        suggestedFix: f.fix,
      })),
    },
    null,
    2,
  )
}

const STR = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/**
 * Parse and *police* a model response. Exported so the grounding guard can be
 * tested directly — it is the seam where an off-contract answer is rejected.
 */
export function parseNarrative(text: string, allowed: Set<string>): ReviewNarrative | null {
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

  // Drop any step the model invented for a finding that does not exist. This is
  // the guard that makes the grounding contract enforced rather than requested.
  const steps: NarratedStep[] = Array.isArray(o.steps)
    ? o.steps
        .map((s) => {
          const so = (s ?? {}) as Record<string, unknown>
          return { id: STR(so.id), explanation: STR(so.explanation), doThis: STR(so.doThis) }
        })
        .filter((s) => s.id && allowed.has(s.id) && (s.explanation || s.doThis))
        .slice(0, MAX_STEPS)
    : []

  const opening = STR(o.opening)
  if (!opening && steps.length === 0) return null

  return { opening, steps, firstMove: STR(o.firstMove), source: "ai" }
}

/**
 * Render the review straight from its own findings — no LLM. Used whenever the
 * model is unavailable, capped, slow, or off-contract, so the walkthrough is
 * always honest even when it is plain.
 */
export function deterministicNarrative(review: ResumeReview): ReviewNarrative {
  const steps: NarratedStep[] = review.findings.slice(0, MAX_STEPS).map((f) => ({
    id: f.id,
    explanation: `${f.observation} ${f.cost}`,
    doThis: f.fix,
  }))

  return {
    opening: review.verdict,
    steps,
    firstMove: review.findings[0]?.fix ?? "",
    source: "fallback",
  }
}

/**
 * Narrate a computed review with Claude, grounded strictly in its findings.
 * Falls back to `deterministicNarrative` on cap, timeout, or parse failure.
 *
 * Any finding the model failed to narrate is back-filled from its own fields, so
 * the walkthrough always has one step per finding — a dropped step would silently
 * hide a problem the engine actually found.
 */
export async function narrateReview(
  anthropic: Anthropic,
  review: ResumeReview,
  userId?: string,
): Promise<ReviewNarrative> {
  if (!review.findings.length) {
    return { opening: review.verdict, steps: [], firstMove: "", source: "fallback" }
  }

  const allowed = new Set(review.findings.map((f) => f.id))

  const { value } = await withAICall<ReviewNarrative | null>({
    anthropic,
    feature: "resume_review",
    timeoutMs: AI_TIMEOUTS.resume_review,
    params: {
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `FACTS:\n${factsFor(review)}` }],
    },
    parse: (text) => parseNarrative(text, allowed),
    fallback: () => null,
    userId,
  })

  if (!value) return deterministicNarrative(review)
  return { ...value, steps: backfillSteps(review, value.steps) }
}

/** One step per finding, in the engine's order, filling gaps deterministically. */
function backfillSteps(review: ResumeReview, narrated: NarratedStep[]): NarratedStep[] {
  const byId = new Map(narrated.map((s) => [s.id, s]))
  return review.findings.slice(0, MAX_STEPS).map((f) => {
    const step = byId.get(f.id)
    if (step?.explanation && step.doThis) return step
    return {
      id: f.id,
      explanation: step?.explanation || `${f.observation} ${f.cost}`,
      doThis: step?.doThis || f.fix,
    }
  })
}

/** Merge a narrative back onto its findings for rendering. */
export function mergeNarrative(
  review: ResumeReview,
  narrative: ReviewNarrative,
): Array<ResumeFinding & { explanation: string; doThis: string }> {
  const byId = new Map(narrative.steps.map((s) => [s.id, s]))
  return review.findings.slice(0, MAX_STEPS).map((f) => {
    const step = byId.get(f.id)
    return {
      ...f,
      explanation: step?.explanation ?? `${f.observation} ${f.cost}`,
      doThis: step?.doThis ?? f.fix,
    }
  })
}
