import Anthropic from '@anthropic-ai/sdk'
import { logApiUsage } from '@/lib/admin/usage'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'claude-haiku-4-5-20251001': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
  },
}

export interface VisaAnalysis {
  sponsors_h1b: boolean | null
  requires_authorization: boolean
  visa_language_detected: string | null
  sponsorship_score: number
}

export async function detectVisaLanguage(description: string): Promise<VisaAnalysis> {
  const truncated = description.slice(0, 3000)

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Analyze this job description for visa/work authorization language.
Return ONLY a JSON object:
- sponsors_h1b: true if job explicitly says they sponsor H1B/visas, false if explicitly says no sponsorship, null if not mentioned
- requires_authorization: true if job says must be authorized to work without sponsorship now or in the future
- visa_language_detected: the exact sentence or phrase about work authorization if found, null if none
- sponsorship_score: 0-100 score where:
  100 = explicitly sponsors H1B
  80 = says open to sponsorship
  60 = no mention either way (neutral)
  20 = implies no sponsorship
  0 = explicitly states no sponsorship

Job description:
${truncated}

Return ONLY valid JSON.`,
      },
    ],
  })

  const pricing = MODEL_PRICING['claude-haiku-4-5-20251001']
  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const estimatedCost =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion

  await logApiUsage({
    service: 'claude',
    operation: 'detect_visa',
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(estimatedCost.toFixed(6)),
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}'

  try {
    const parsed = JSON.parse(text)
    return {
      sponsors_h1b: parsed.sponsors_h1b ?? null,
      requires_authorization: Boolean(parsed.requires_authorization),
      visa_language_detected: parsed.visa_language_detected ?? null,
      sponsorship_score: typeof parsed.sponsorship_score === 'number'
        ? Math.min(100, Math.max(0, parsed.sponsorship_score))
        : 60,
    }
  } catch {
    return { sponsors_h1b: null, requires_authorization: false, visa_language_detected: null, sponsorship_score: 60 }
  }
}
