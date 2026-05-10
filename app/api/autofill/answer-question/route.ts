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
import { sanitizeGeneratedText, replaceEmDash } from "@/lib/text/sanitize-generated-text"

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

  // Fetch the user's primary resume
  const pool = getPostgresPool()
  const resumeResult = await pool.query<{
    summary: string | null
    primary_role: string | null
    top_skills: string[] | null
    work_experience: Array<{ title: string; company: string; duration?: string; description?: string }> | null
    education: Array<{ degree: string; institution: string; year?: number }> | null
    years_of_experience: number | null
    raw_text: string | null
  }>(
    `SELECT summary, primary_role, top_skills, work_experience, education, years_of_experience, raw_text
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

  // Build a compact resume context — prefer structured data over raw text
  const resumeContext = buildResumeContext(resume)
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
        content: `Resume summary:
${resumeContext}

Applying for: ${jobContext}

Question: "${question}"

Write a concise answer based only on the resume above.`,
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

function buildResumeContext(resume: {
  summary: string | null
  primary_role: string | null
  top_skills: string[] | null
  work_experience: Array<{ title: string; company: string; duration?: string; description?: string }> | null
  education: Array<{ degree: string; institution: string; year?: number }> | null
  years_of_experience: number | null
  raw_text: string | null
}): string {
  const parts: string[] = []

  if (resume.primary_role) parts.push(`Role: ${resume.primary_role}`)
  if (resume.years_of_experience) parts.push(`Experience: ${resume.years_of_experience} years`)
  if (resume.summary) parts.push(`Summary: ${resume.summary}`)
  if (resume.top_skills?.length) parts.push(`Skills: ${resume.top_skills.slice(0, 15).join(", ")}`)

  if (resume.work_experience?.length) {
    const jobs = resume.work_experience.slice(0, 3).map((j) =>
      `${j.title} at ${j.company}${j.duration ? ` (${j.duration})` : ""}${j.description ? `: ${j.description.slice(0, 120)}` : ""}`
    )
    parts.push(`Experience:\n${jobs.join("\n")}`)
  }

  if (resume.education?.length) {
    const edu = resume.education.slice(0, 2).map((e) =>
      `${e.degree} — ${e.institution}${e.year ? ` (${e.year})` : ""}`
    )
    parts.push(`Education: ${edu.join("; ")}`)
  }

  // Fallback to raw text if structured data is sparse
  if (parts.length < 3 && resume.raw_text) {
    parts.push(`Resume text (excerpt): ${resume.raw_text.slice(0, 800)}`)
  }

  return parts.join("\n")
}
