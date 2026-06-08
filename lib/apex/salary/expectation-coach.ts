import Anthropic from "@anthropic-ai/sdk"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { benchmarkSalary } from "@/lib/offers/salary-benchmarker"
import { getPostgresPool } from "@/lib/postgres/server"

export type ExpectationScript = {
  screeningAnswer: string
  emailAnswer: string
  doNotSay: string[]
  negotiationRoom: string
  marketContext: string
}

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const VISA_STATUSES_LESS_LEVERAGE = new Set([
  "F1_OPT", "F1_STEM_OPT", "H1B", "OPT", "STEM_OPT", "needs_future_sponsorship",
])

export async function generateSalaryExpectationScript(
  userId: string,
  jobTitle: string,
  location: string,
  visaStatus: string
): Promise<ExpectationScript> {
  const pool = getPostgresPool()

  // Get user's years of experience from profile
  const profileResult = await pool.query<{ top_skills: string[] | null }>(
    `SELECT top_skills FROM resumes
     WHERE user_id = $1 AND is_primary = true AND parse_status = 'complete'
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  )

  // Try to get years of experience from cohort_members or applications
  const expResult = await pool.query<{ avg_exp: string | null }>(
    `SELECT AVG(years_experience)::text AS avg_exp
     FROM cohort_members WHERE user_id = $1`,
    [userId]
  )
  const yearsExperience = expResult.rows[0]?.avg_exp
    ? Math.round(parseFloat(expResult.rows[0].avg_exp))
    : 5

  const benchmark = await benchmarkSalary(jobTitle, location, yearsExperience, undefined, null)

  const isOnVisa = VISA_STATUSES_LESS_LEVERAGE.has(visaStatus)
  const p50 = benchmark.marketP50
  const p75 = benchmark.marketP75

  const rangeFloor = Math.round(p50 / 5000) * 5000
  const rangeCeil = Math.round(p75 / 5000) * 5000

  const fallback: ExpectationScript = {
    screeningAnswer: `Based on my research and experience, I'm targeting a base salary in the range of $${rangeFloor.toLocaleString()}–$${rangeCeil.toLocaleString()} for this type of role in ${location}. I'm open to discussing the full compensation package including equity and bonuses.`,
    emailAnswer: `My salary expectations are in the range of $${rangeFloor.toLocaleString()}–$${rangeCeil.toLocaleString()} base, based on market data for ${jobTitle} roles in ${location}.`,
    doNotSay: [
      `Do not say "I'm flexible" — it signals you'll accept any number`,
      `Do not give a range starting below $${rangeFloor.toLocaleString()}`,
      `Do not apologize for your ask`,
      `Do not say "I just need the opportunity" — it devalues your experience`,
      `Do not reveal your current or past salary if avoidable (illegal to ask in many states)`,
    ],
    negotiationRoom: isOnVisa
      ? `You have moderate negotiation room. Because visa sponsorship is involved, avoid making the salary conditional on sponsorship confirmation — negotiate comp separately from the sponsorship discussion. Focus on the data: your market rate is $${p50.toLocaleString()}–$${p75.toLocaleString()}.`
      : `You have solid negotiation room. The market range for your role is $${p50.toLocaleString()}–$${p75.toLocaleString()}. Quoting P75 as your anchor ($${p75.toLocaleString()}) gives you room to land at P50 which is still market rate.`,
    marketContext: `${benchmark.source} | ${benchmark.locationType}`,
  }

  if (!anthropic) return fallback

  const visaGuidance = isOnVisa
    ? `The user is on a visa (${visaStatus}). CRITICAL: Never suggest making salary conditional on visa sponsorship. Keep sponsorship and salary as entirely separate conversations. Be honest that visa status slightly reduces negotiating leverage but don't overstate this.`
    : ""

  try {
    const message = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: `You are a salary negotiation coach. Generate a salary expectation script for this person.

CONTEXT:
- Role: ${jobTitle}
- Location: ${location}
- Years of experience: ${yearsExperience}
- Market P50: $${p50.toLocaleString()}
- Market P75: $${p75.toLocaleString()}
- Data source: ${benchmark.source}

${visaGuidance}

Generate a JSON response with this exact shape:
{
  "screeningAnswer": "<2-3 sentences to say on a recruiter screening call when asked about salary expectations. Confident, specific range, references market research. Under 80 words.>",
  "emailAnswer": "<1-2 sentences for a salary expectations field in an email or form. Crisp, professional.>",
  "doNotSay": ["<phrase to avoid>", "<phrase to avoid>", "<phrase to avoid>", "<phrase to avoid>", "<phrase to avoid>"],
  "negotiationRoom": "<1-2 sentences on how much room this person has to push and why. Honest about visa leverage if applicable.>"
}

Rules:
- Use the exact dollar numbers from the context — never invent figures
- The range floor must be at or above P50
- doNotSay items must be concrete and actionable ("Do not say X" format)
- Never suggest visa sponsorship as a negotiation chip
- Never guarantee success`,
        },
      ],
    })

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return fallback

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ExpectationScript>
    return {
      screeningAnswer: typeof parsed.screeningAnswer === "string" ? parsed.screeningAnswer : fallback.screeningAnswer,
      emailAnswer: typeof parsed.emailAnswer === "string" ? parsed.emailAnswer : fallback.emailAnswer,
      doNotSay: Array.isArray(parsed.doNotSay)
        ? (parsed.doNotSay as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 6)
        : fallback.doNotSay,
      negotiationRoom: typeof parsed.negotiationRoom === "string" ? parsed.negotiationRoom : fallback.negotiationRoom,
      marketContext: fallback.marketContext,
    }
  } catch {
    return fallback
  }
}
