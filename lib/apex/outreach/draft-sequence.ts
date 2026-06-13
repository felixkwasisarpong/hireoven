/**
 * Generates the message drafts for every step of an outreach sequence in a
 * single AI call. The user reviews, edits, and sends each one manually — Apex
 * never sends (see outreach/types.ts). Deterministic fallback on timeout so a
 * sequence is always usable even if the model is unavailable.
 */
import Anthropic from "@anthropic-ai/sdk"
import { HAIKU_MODEL } from "@/lib/ai/anthropic-models"
import { withAICall } from "@/lib/apex/budget/ai-call"
import type { CadenceStep, OutreachChannel, OutreachGoal } from "./sequence"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

export type SequenceDraftContext = {
  goal: OutreachGoal
  channel: OutreachChannel
  candidateName: string
  candidateHeadline: string
  topStrengths: string[]
  companyName: string
  jobTitle: string | null
  contactName: string | null
  contactRole: string | null
}

const GOAL_FRAMING: Record<OutreachGoal, string> = {
  referral_request: "asking this person to refer the candidate or pass along their resume",
  recruiter_intro: "introducing the candidate to a recruiter for a role they're filling",
  hiring_manager: "reaching a hiring manager directly about joining their team",
}

const SYSTEM_PROMPT = `You write outbound job-search outreach for a candidate. You produce a short MULTI-TOUCH sequence: an initial message and timed follow-ups, each shorter than the last.

Rules:
- Each message stands alone but builds on the prior one (later ones reference "following up" naturally, never repeat the same opener).
- Specific, human, confident. Reference the role/company/contact concretely.
- The initial message under 130 words; follow-ups under 70 words.
- For email channel, start each with a "Subject:" line; for linkedin, no subject.
- Use [Name] / [Company] placeholders only when the real value is unknown.
- NEVER: "I hope this finds you well", "I'm reaching out because", "Would love to connect", desperation, or guarantees about sponsorship/referrals you can't make.
- NO em dashes or en dashes anywhere. Use commas, periods, or "to" for ranges.

Return ONLY JSON: {"steps":[{"stepNumber":1,"draft":"..."},...]} with one entry per requested step, in order.`

function fallbackDrafts(ctx: SequenceDraftContext, steps: CadenceStep[]): { stepNumber: number; draft: string }[] {
  const who = ctx.contactName ?? "there"
  const role = ctx.jobTitle ? ` for the ${ctx.jobTitle} role` : ""
  const subj = ctx.channel === "email" ? `Subject: ${ctx.jobTitle ?? "Quick note"} at ${ctx.companyName}\n\n` : ""
  return steps.map((s, i) => {
    if (i === 0) {
      return {
        stepNumber: i + 1,
        draft: `${subj}Hi ${who}, I'm ${ctx.candidateName}, ${ctx.candidateHeadline}. I'm very interested in ${ctx.companyName}${role} and think my background lines up well. Would you be open to a quick chat or pointing me to the right person? Happy to share more. Thanks, ${ctx.candidateName}`,
      }
    }
    return {
      stepNumber: i + 1,
      draft: `${ctx.channel === "email" ? "Subject: Following up\n\n" : ""}Hi ${who}, following up on my note about ${ctx.companyName}${role}. Still keen and happy to make this easy on your end. No worries if the timing isn't right. Thanks, ${ctx.candidateName}`,
    }
  })
}

export async function generateSequenceDrafts(
  ctx: SequenceDraftContext,
  steps: CadenceStep[],
): Promise<{ stepNumber: number; draft: string }[]> {
  if (!anthropic) return fallbackDrafts(ctx, steps)

  const inputs = {
    intent: GOAL_FRAMING[ctx.goal],
    channel: ctx.channel,
    candidate: { name: ctx.candidateName, headline: ctx.candidateHeadline, strengths: ctx.topStrengths.slice(0, 5) },
    target: { company: ctx.companyName, role: ctx.jobTitle, contact_name: ctx.contactName, contact_role: ctx.contactRole },
    steps: steps.map((s, i) => ({ stepNumber: i + 1, kind: s.kind, purpose: s.purpose })),
  }

  const { value } = await withAICall<{ stepNumber: number; draft: string }[] | null>({
    anthropic,
    feature: "apex_follow_up",
    timeoutMs: 16_000,
    params: {
      model: HAIKU_MODEL,
      max_tokens: 1400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(inputs, null, 2) }],
    },
    fallback: () => null,
    parse: (text: string) => {
      const m = text.match(/\{[\s\S]*\}/)
      if (!m) return null
      try {
        const parsed = JSON.parse(m[0]) as { steps?: { stepNumber: number; draft: string }[] }
        return Array.isArray(parsed.steps) && parsed.steps.length > 0 ? parsed.steps : null
      } catch {
        return null
      }
    },
  })

  if (!value) return fallbackDrafts(ctx, steps)
  // Ensure every requested step has a draft, in order.
  return steps.map((_, i) => {
    const found = value.find((v) => v.stepNumber === i + 1)
    return found ?? fallbackDrafts(ctx, steps)[i]
  })
}
