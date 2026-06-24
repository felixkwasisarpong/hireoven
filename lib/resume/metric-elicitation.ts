/**
 * Metric elicitation — turn a vague, number-less resume bullet into a
 * quantified one using the candidate's REAL numbers.
 *
 * The old "quantify" action just stuffed `[X%]`/`[X users]` placeholders into a
 * bullet and hoped the candidate would replace them — most never did, so resumes
 * shipped with literal brackets. This module instead:
 *
 *   1. generateMetricQuestions() — looks at one bullet and asks 1–4 targeted
 *      questions about the metrics that bullet could plausibly carry
 *      ("Roughly how much did deploy time drop?", "How many services did you
 *      migrate?"). Neutral phrasing — never pressures the candidate to invent.
 *   2. rewriteBulletWithMetrics() — rewrites the bullet weaving in ONLY the
 *      answers the candidate actually provided. Skipped answers are dropped, no
 *      numbers are invented, and no placeholders survive. If the candidate
 *      skips everything, it falls back to a strong qualitative rewrite with no
 *      fabricated figures.
 *
 * Truthful by construction: the model never sees a number it can put in unless
 * the candidate typed it.
 */

import Anthropic from "@anthropic-ai/sdk"
import { logApiUsage } from "@/lib/admin/usage"
import { ANTHROPIC_TIER_PRICING, SONNET_MODEL } from "@/lib/ai/anthropic-models"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const MODEL = SONNET_MODEL
const MODEL_PRICING = ANTHROPIC_TIER_PRICING.sonnet

/** The kind of number a question is fishing for — drives the input hint/keyboard. */
export type MetricQuestionKind = "percent" | "count" | "money" | "time" | "scale" | "text"

export type MetricQuestion = {
  id: string
  /** The question shown to the candidate. */
  label: string
  /** A short example/placeholder for the input (e.g. "e.g. 40%", "e.g. 12"). */
  hint: string
  kind: MetricQuestionKind
}

export type MetricAnswer = {
  /** Echoes the question label so the rewrite prompt has the full Q→A pair. */
  label: string
  /** What the candidate typed. Empty/whitespace = skipped. */
  value: string
}

type BulletContext = {
  bullet: string
  jobTitle: string
  company: string
  jobDescription?: string | null
}

function extractText(message: Anthropic.Messages.Message) {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim()
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? text).trim()
  const objectMatch = candidate.match(/\{[\s\S]*\}/)
  if (!objectMatch) throw new Error("no_json_object")
  return JSON.parse(objectMatch[0].replace(/,\s*([}\]])/g, "$1"))
}

async function logUsage(message: Anthropic.Messages.Message, operation: string) {
  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const costUsd =
    (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion
  await logApiUsage({
    service: "claude",
    operation,
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(costUsd.toFixed(6)),
  })
}

const VALID_KINDS: ReadonlySet<MetricQuestionKind> = new Set([
  "percent",
  "count",
  "money",
  "time",
  "scale",
  "text",
])

const HINT_BY_KIND: Record<MetricQuestionKind, string> = {
  percent: "e.g. 40%",
  count: "e.g. 12",
  money: "e.g. $250K",
  time: "e.g. 6 weeks",
  scale: "e.g. 10k users",
  text: "e.g. ...",
}

/** Strip any leftover `[X%]`, `<metric>`, `(add number)` style placeholders. */
function stripPlaceholders(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\(\s*(?:add|insert|your|tbd|fill in)[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim()
}

/**
 * Ask the model for the handful of metrics this specific bullet could carry.
 * Returns [] when AI is unavailable so the caller can degrade gracefully.
 */
export async function generateMetricQuestions(ctx: BulletContext): Promise<MetricQuestion[]> {
  if (!anthropic) return []

  const jdLine = ctx.jobDescription?.trim()
    ? `\nTarget job context (only to judge which metrics matter — do NOT invent any):\n${ctx.jobDescription.slice(0, 1200)}`
    : ""

  const system =
    "You are a resume coach helping a candidate quantify a single accomplishment with their REAL numbers. " +
    "You only ASK questions — you never invent or assume figures. " +
    "Each question targets one concrete, plausible metric the bullet could carry (impact, scale, time saved, money, volume, frequency). " +
    "Phrase neutrally so the candidate reports a true number and never feels pushed to inflate. " +
    "Skip metrics that make no sense for the bullet. Return JSON only."

  const user = `Resume bullet:
"${ctx.bullet}"

Role: ${ctx.jobTitle} at ${ctx.company}${jdLine}

Generate 1–4 short questions whose answers would let this bullet show measurable impact. Prefer the highest-impact metrics first. Each question must be answerable with a short number/phrase.

Return JSON only:
{
  "questions": [
    { "label": "How much did X improve?", "kind": "percent" }
  ]
}
"kind" is one of: "percent" (a %), "count" (a whole number of things), "money" ($ amount), "time" (duration/time saved), "scale" (size: users/requests/team/revenue), "text" (a short non-numeric specifier). Maximum 4 questions. No commentary.`

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: user }],
    })
    await logUsage(message, "resume_metric_questions")
    const parsed = extractJsonObject(extractText(message)) as { questions?: unknown }
    const raw = Array.isArray(parsed.questions) ? parsed.questions : []
    const questions: MetricQuestion[] = []
    for (const item of raw) {
      if (!item || typeof item !== "object") continue
      const label = typeof (item as { label?: unknown }).label === "string" ? (item as { label: string }).label.trim() : ""
      if (!label) continue
      const rawKind = (item as { kind?: unknown }).kind
      const kind: MetricQuestionKind =
        typeof rawKind === "string" && VALID_KINDS.has(rawKind as MetricQuestionKind)
          ? (rawKind as MetricQuestionKind)
          : "text"
      questions.push({ id: `q${questions.length + 1}`, label, hint: HINT_BY_KIND[kind], kind })
      if (questions.length >= 4) break
    }
    return questions
  } catch (error) {
    console.error("generateMetricQuestions failed", error)
    return []
  }
}

/**
 * Rewrite the bullet using only the answers the candidate actually supplied.
 * Never invents numbers; drops skipped answers; strips any placeholder syntax.
 * Falls back to the original bullet on error.
 */
export async function rewriteBulletWithMetrics(
  ctx: BulletContext & { answers: MetricAnswer[] }
): Promise<{ suggestion: string; usedMetrics: boolean }> {
  const provided = ctx.answers
    .map((a) => ({ label: a.label.trim(), value: a.value.trim() }))
    .filter((a) => a.label && a.value)

  if (!anthropic) {
    return { suggestion: ctx.bullet, usedMetrics: false }
  }

  const factsBlock = provided.length
    ? provided.map((a) => `- ${a.label} → ${a.value}`).join("\n")
    : "(none — the candidate did not provide any numbers)"

  const system =
    "You are an expert resume writer. You rewrite a single bullet to be sharp and quantified, " +
    "but you may ONLY use facts the candidate explicitly provided. " +
    "You NEVER invent, estimate, or round metrics, and you NEVER emit placeholders like [X%], <metric>, or (add number). " +
    "Keep the candidate's real meaning and voice; sound human, not like AI corporate-speak. " +
    "Return only the rewritten bullet text — no quotes, no labels, no commentary."

  const user = `Original bullet:
"${ctx.bullet}"

Role: ${ctx.jobTitle} at ${ctx.company}

Candidate-provided metrics (use these verbatim where they fit; ignore any that don't):
${factsBlock}

Rules:
- Start with a strong past-tense action verb.
- Weave in ONLY the provided metrics above. Do not add any number that is not listed.
- If no metrics were provided, return a strong qualitative rewrite with NO numbers and NO placeholders.
- One bullet, max 2 lines. No brackets, no placeholders, no meta-notes.

Return ONLY the rewritten bullet.`

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    })
    await logUsage(message, "resume_metric_rewrite")
    const cleaned = stripPlaceholders(extractText(message).replace(/^["']|["']$/g, ""))
    return {
      suggestion: cleaned || ctx.bullet,
      usedMetrics: provided.length > 0,
    }
  } catch (error) {
    console.error("rewriteBulletWithMetrics failed", error)
    return { suggestion: ctx.bullet, usedMetrics: false }
  }
}
