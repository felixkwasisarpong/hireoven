import Anthropic from "@anthropic-ai/sdk"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import type { NegotiationAnalysis, CounterOfferPackage } from "./types"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// Hard filter: remove any language that makes the offer conditional on visa outcomes.
// This protects users on visas from making legally dangerous statements.
const VISA_DANGER_PHRASES = [
  /i will only accept if you (?:sponsor|guarantee|provide|confirm).{0,60}(?:visa|h-?1b|sponsorship)/gi,
  /my acceptance is conditional on.{0,60}(?:visa|sponsorship|h-?1b)/gi,
  /i won't accept unless you guarantee.{0,60}(?:visa|h-?1b|sponsorship)/gi,
  /(?:contingent|conditioned) (?:on|upon).{0,60}(?:visa|sponsorship|immigration)/gi,
]

function filterVisaDangerLanguage(text: string): string {
  let safe = text
  for (const re of VISA_DANGER_PHRASES) {
    safe = safe.replace(re, "[Please confirm sponsorship support separately with HR before proceeding.]")
  }
  return safe
}

function buildPrompt(
  analysis: NegotiationAnalysis,
  tone: "formal" | "warm" | "direct",
  visaStatus: string
): string {
  const { salaryAnalysis, componentAnalysis, negotiationStrategy, counterOfferScript } = analysis
  const isOnVisa = ["F1_OPT", "F1_STEM_OPT", "H1B", "OPT", "STEM_OPT", "needs_future_sponsorship"].includes(visaStatus)

  const toneGuidance =
    tone === "formal"
      ? "Use formal, professional business language. Clear and precise."
      : tone === "warm"
        ? "Use a warm, collaborative tone. Enthusiastic about the role but firm on numbers."
        : "Use a direct, confident tone. Get to the ask quickly without excessive hedging."

  const visaGuidance = isOnVisa
    ? `CRITICAL — USER IS ON A VISA (${visaStatus}):
- NEVER write language suggesting the offer acceptance is conditional on visa sponsorship
- NEVER write "I will only accept if you sponsor my visa" or any equivalent
- NEVER reference visa status in negotiation scripts — it weakens leverage and is legally risky
- If visa is relevant, keep it factual and separate from the compensation ask
- Sponsorship should be confirmed separately by HR before the user signs anything`
    : ""

  return `You are an expert job offer negotiation coach. Generate a complete negotiation package.

OFFER CONTEXT:
- Offered base salary: ${salaryAnalysis.offered ? `$${salaryAnalysis.offered.toLocaleString()}` : "Unknown"}
- Market P50 for this role/location: $${salaryAnalysis.marketP50.toLocaleString()}
- Market P75: $${salaryAnalysis.marketP75.toLocaleString()}
- Salary is below market: ${salaryAnalysis.isBelowMarket}
- Percentile position: ${salaryAnalysis.percentilePosition}
- Recommended salary ask: $${counterOfferScript.salaryAsk.toLocaleString()}
- Fallback position: $${counterOfferScript.fallbackPosition.toLocaleString()}
- Recommended approach: ${negotiationStrategy.recommendedApproach}
- Estimated upside: $${negotiationStrategy.estimatedUpside.toLocaleString()}
- Priority components: ${negotiationStrategy.priorityComponents.join(", ")}

COMPONENT ANALYSIS:
${componentAnalysis.map((c) => `- ${c.component}: offered ${c.offeredValue}, market: ${c.marketBenchmark}, potential: ${c.negotiationPotential}`).join("\n")}

TONE: ${toneGuidance}

${visaGuidance}

Generate a JSON response with exactly this shape:
{
  "emailScript": "A complete, ready-to-send counter-offer email. Include subject line at the top. Use specific dollar amounts. Reference market data. 3-5 paragraphs.",
  "verbalScript": "A complete verbal script for a phone negotiation call. Include natural pauses and response branches for 'yes', 'let me check', and 'no'. 200-350 words.",
  "fallbackPositions": [
    { "ask": <number>, "justification": "<string>" },
    { "ask": <number>, "justification": "<string>" },
    { "ask": <number>, "justification": "<string>" }
  ],
  "doNotSayList": ["<phrase to avoid>", "<phrase to avoid>", "<phrase to avoid>", "<phrase to avoid>", "<phrase to avoid>"],
  "bestTimeToNegotiate": "<when and how to time the ask — 1-2 sentences>",
  "estimatedSuccessRate": "<honest percentage range + brief explanation>"
}

Rules:
- Use ONLY specific numbers from the context above — never invent salary figures
- The email must have a subject line as the first line
- fallbackPositions[0] should be the initial ask, [1] a middle ground, [2] minimum acceptable
- doNotSayList should include toxic phrases that weaken negotiating position
- Never guarantee an outcome
- Never suggest accepting anything below the fallback position silently
- Keep the email under 300 words; verbal script under 350 words`
}

export async function generateCounterOffer(
  negotiationAnalysis: NegotiationAnalysis,
  userTone: "formal" | "warm" | "direct",
  userVisaStatus: string
): Promise<CounterOfferPackage> {
  const fallback: CounterOfferPackage = {
    emailScript: negotiationAnalysis.counterOfferScript.fullScript,
    verbalScript: `On your call: Start with "${negotiationAnalysis.counterOfferScript.openingLine}" — then reference the market data and ask for ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(negotiationAnalysis.counterOfferScript.salaryAsk)}.`,
    fallbackPositions: [
      { ask: negotiationAnalysis.counterOfferScript.salaryAsk, justification: "Initial ask based on market P75" },
      { ask: negotiationAnalysis.salaryAnalysis.marketP50, justification: "Market median — acceptable middle ground" },
      { ask: negotiationAnalysis.counterOfferScript.fallbackPosition, justification: "Minimum to close the gap from current offer" },
    ],
    doNotSayList: [
      "I really need this job",
      "I'll take whatever you can offer",
      "I know this might be too much to ask",
      "I'm flexible, anything works",
      "I'll accept even if you can't change it",
    ],
    bestTimeToNegotiate: "Ask within 24–48 hours of receiving the offer. Monday–Wednesday mornings work best.",
    estimatedSuccessRate: "60–80% — most employers expect negotiation and have budget flexibility.",
  }

  if (!anthropic) return fallback

  try {
    const message = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: buildPrompt(negotiationAnalysis, userTone, userVisaStatus),
        },
      ],
    })

    const rawText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")

    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return fallback

    const parsed = JSON.parse(jsonMatch[0]) as Partial<CounterOfferPackage>

    const emailScript = filterVisaDangerLanguage(
      typeof parsed.emailScript === "string" ? parsed.emailScript : fallback.emailScript
    )
    const verbalScript = filterVisaDangerLanguage(
      typeof parsed.verbalScript === "string" ? parsed.verbalScript : fallback.verbalScript
    )

    const fallbackPositions = Array.isArray(parsed.fallbackPositions)
      ? (parsed.fallbackPositions as Array<{ ask: unknown; justification: unknown }>)
          .filter((p) => typeof p.ask === "number" && typeof p.justification === "string")
          .slice(0, 3)
          .map((p) => ({ ask: p.ask as number, justification: p.justification as string }))
      : fallback.fallbackPositions

    const doNotSayList = Array.isArray(parsed.doNotSayList)
      ? (parsed.doNotSayList as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 8)
      : fallback.doNotSayList

    return {
      emailScript,
      verbalScript,
      fallbackPositions: fallbackPositions.length > 0 ? fallbackPositions : fallback.fallbackPositions,
      doNotSayList,
      bestTimeToNegotiate: typeof parsed.bestTimeToNegotiate === "string" ? parsed.bestTimeToNegotiate : fallback.bestTimeToNegotiate,
      estimatedSuccessRate: typeof parsed.estimatedSuccessRate === "string" ? parsed.estimatedSuccessRate : fallback.estimatedSuccessRate,
    }
  } catch {
    return fallback
  }
}
