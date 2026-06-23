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

  // Fetch the user's primary resume — the full parsed structure so the model
  // answers from real work history, achievements and education.
  const pool = getPostgresPool()
  const resumeResult = await pool.query<ResumeRow>(
    `SELECT summary, primary_role, top_skills, work_experience, education,
            projects, years_of_experience, raw_text
     FROM resumes
     WHERE user_id = $1
     ORDER BY is_primary DESC, updated_at DESC
     LIMIT 1`,
    [user.id]
  ).catch(() => null)

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
  const jobContext = [jobTitle, company].filter(Boolean).join(" at ") || "this role"

  const message = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 300,
    system: `You are helping a job applicant answer application form questions based on their resume.
Write a concise, honest, first-person answer that matches the question length expectations.
- For yes/no or numeric questions: answer directly (e.g. "3 years", "Yes").
- For short text questions: 1–2 sentences.
- For open-ended questions: 2–4 sentences max, professional tone.
- Never fabricate experience not in the resume.
- Return only the answer text, no preamble or explanation.`,
    messages: [
      {
        role: "user",
        content: `Applicant's résumé:
${resumeContext}

Applying for: ${jobContext}

Question: "${question}"

Write a concise answer grounded only in the résumé above.`,
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
