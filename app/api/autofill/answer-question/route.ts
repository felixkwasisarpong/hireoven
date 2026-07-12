/**
 * POST /api/autofill/answer-question
 *
 * Uses the user's primary resume to generate a tailored answer to an
 * open-ended application question (e.g. "Why do you want this role?",
 * "Describe a challenge you overcame", "Years of React experience?").
 *
 * Body:
 *   question    string  — the field label / question text from the form
 *   jobTitle    string? — job title for context
 *   company     string? — company name for context
 *
 * Returns: { answer: string }
 */

import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { logApiUsage } from "@/lib/admin/usage"
import { HAIKU_MODEL, ANTHROPIC_TIER_PRICING } from "@/lib/ai/anthropic-models"
import { requireFeature } from "@/lib/gates/server-gate"
import { requireQuota } from "@/lib/usage/server-quota"
import { sanitizeGeneratedText, replaceEmDash } from "@/lib/text/sanitize-generated-text"
import { formatResumeContext } from "@/lib/autofill/resume-context"

export const runtime = "nodejs"
export const maxDuration = 30

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

export async function POST(request: Request) {
  const gate = await requireFeature("autofill", request as Parameters<typeof requireFeature>[1])
  if (gate instanceof NextResponse) return gate

  if (!anthropic) return NextResponse.json({ error: "AI not configured" }, { status: 503 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    question?: string
    jobTitle?: string
    company?: string
  }

  const { question, jobTitle, company } = body
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 })
  }

  // Fetch the user's primary resume + structured autofill profile in parallel.
  // The résumé grounds work history/skills; the autofill profile grounds the
  // "hard fact" questions (salary, work authorization, relocation, start date)
  // that a résumé alone can't answer well.
  const pool = getPostgresPool()
  const [resumeResult, profileResult] = await Promise.all([
    pool.query<ResumeRow>(
      `SELECT summary, primary_role, top_skills, work_experience, education,
              projects, years_of_experience, raw_text
       FROM resumes
       WHERE user_id = $1
       ORDER BY is_primary DESC, updated_at DESC
       LIMIT 1`,
      [user.id]
    ).catch(() => null),
    pool.query<AutofillProfileRow>(
      `SELECT city, work_authorization, authorized_to_work, requires_sponsorship,
              sponsorship_statement, years_of_experience,
              salary_expectation_min, salary_expectation_max,
              earliest_start_date, willing_to_relocate
       FROM autofill_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [user.id]
    ).catch(() => null),
  ])

  const resume = resumeResult?.rows[0] ?? null

  if (!resume) {
    return NextResponse.json({ error: "No resume found — upload one in Hireoven first." }, { status: 404 })
  }

  const quota = await requireQuota(gate.userId, "autofill", gate.plan)
  if (quota instanceof NextResponse) return quota

  // Build a complete resume context — full structured data, raw-text fallback.
  const resumeContext = formatResumeContext(resume)
  if (!resumeContext) {
    return NextResponse.json({ error: "No resume found — upload one in Hireoven first." }, { status: 404 })
  }
  const profile = profileResult?.rows[0] ?? null
  const profileContext = buildProfileContext(profile)
  const salaryGuidance = buildSalaryGuidance(profile)
  const jobContext = [jobTitle, company].filter(Boolean).join(" at ") || "this role"

  const message = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 300,
    system: `You help a job applicant answer application-form questions. Answer as the applicant, first person. Match the answer length to the question. Return ONLY the answer text — no preamble, no quotes, no explanation.

MATCH THE QUESTION TYPE:
- Yes/No → answer with just "Yes" or "No" (nothing more) unless it clearly wants a sentence.
- Numeric (years, count) → the number, optionally with a unit ("3 years", "5").
- Short text → 1 sentence.
- Open-ended ("Why this role?", "Tell us about yourself", "Why this company?") → 2–4 sentences, specific to THIS job, and tie it to a concrete achievement from the résumé. Sound like a real person: no "I am passionate about", no generic filler, no clichés.

HARD FACTS — answer truthfully from the applicant profile, never guess:
- Work authorization, sponsorship, citizenship, clearance, licenses, criminal/background → from the profile only. If not in the profile, give the safest truthful answer and don't invent specifics.
- Location / relocation / start date → from the profile.

SKILLS & EXPERIENCE — be confident, don't undersell. If the question asks about a tool/skill in the SAME domain as the applicant's background (and the résumé supports the domain), answer affirmatively; strong engineers pick up adjacent tools fast. But NEVER fabricate a specific named tool, employer, credential, or metric that isn't supported by the résumé.

SALARY — think, don't just echo a number:
${salaryGuidance}

DEMOGRAPHIC / EEO questions (gender, race, ethnicity, veteran, disability) → answer "Prefer not to say" / "Decline to self-identify". Do not infer these from the résumé.`,
    messages: [
      {
        role: "user",
        content: `Applicant's résumé:
${resumeContext}
${profileContext ? `\nApplicant profile (hard facts):\n${profileContext}\n` : ""}
Applying for: ${jobContext}

Question: "${question}"

Write the answer, grounded only in the résumé and profile above.`,
      },
    ],
  })

  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  await logApiUsage({
    service: "claude",
    operation: "autofill_answer_question",
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(
      (
        (inputTokens / 1_000_000) * ANTHROPIC_TIER_PRICING.haiku.inputPerMillion +
        (outputTokens / 1_000_000) * ANTHROPIC_TIER_PRICING.haiku.outputPerMillion
      ).toFixed(6)
    ),
  })

  const raw = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .replace(/^["']|["']$/g, "")

  const answer = replaceEmDash(raw)

  return NextResponse.json(sanitizeGeneratedText({ answer }))
}

type ResumeRow = {
  summary: string | null
  primary_role: string | null
  top_skills: string[] | null
  work_experience: unknown
  education: unknown
  projects: unknown
  years_of_experience: number | null
  raw_text: string | null
}

type AutofillProfileRow = {
  city: string | null
  work_authorization: string | null
  authorized_to_work: boolean | null
  requires_sponsorship: boolean | null
  sponsorship_statement: string | null
  years_of_experience: number | null
  salary_expectation_min: number | null
  salary_expectation_max: number | null
  earliest_start_date: string | null
  willing_to_relocate: boolean | null
}

/** Render the profile "hard facts" the model must answer truthfully from.
 *  EEO/demographic fields are deliberately excluded (privacy-preserving). */
function buildProfileContext(p: AutofillProfileRow | null): string {
  if (!p) return ""
  const lines: string[] = []
  if (p.city) lines.push(`Location: ${p.city}`)
  if (p.work_authorization) lines.push(`Work authorization: ${p.work_authorization}`)
  else if (p.authorized_to_work != null) lines.push(`Authorized to work: ${p.authorized_to_work ? "Yes" : "No"}`)
  if (p.requires_sponsorship != null) lines.push(`Requires sponsorship: ${p.requires_sponsorship ? "Yes" : "No"}`)
  if (p.sponsorship_statement) lines.push(`Sponsorship note: ${p.sponsorship_statement}`)
  if (p.willing_to_relocate != null) lines.push(`Willing to relocate: ${p.willing_to_relocate ? "Yes" : "No"}`)
  if (p.earliest_start_date) lines.push(`Earliest start date: ${p.earliest_start_date}`)
  if (p.years_of_experience != null) lines.push(`Years of experience: ${p.years_of_experience}`)
  return lines.join("\n")
}

/** Salary answer strategy, grounded in the applicant's expectation range when
 *  set. Mirrors a floor + posted-range-midpoint heuristic so the model gives a
 *  considered number instead of blindly echoing the floor or lowballing. */
function buildSalaryGuidance(p: AutofillProfileRow | null): string {
  const min = p?.salary_expectation_min ?? null
  const max = p?.salary_expectation_max ?? null
  const floorLine =
    min != null
      ? `The applicant's floor is $${min.toLocaleString()}${max != null ? ` and target range is $${min.toLocaleString()}–$${max.toLocaleString()}` : ""}. Never answer below the floor.`
      : `No fixed expectation is set — give a market-reasonable figure for the role and seniority implied by the résumé.`
  return `${floorLine}
- Posting shows a range → answer the MIDPOINT of the posted range (if at/above the floor).
- Asked for a single number and no posted range → use the target${max != null ? " midpoint" : min != null ? " floor" : ""}.
- Asked for a range → give the target range${min != null && max != null ? ` ($${min.toLocaleString()}–$${max.toLocaleString()})` : ""}, or posted-midpoint ±10%.
- Hourly rate → divide the annual figure by 2080.
- Different currency → target the midpoint of the posting's range; convert if needed.`
}
