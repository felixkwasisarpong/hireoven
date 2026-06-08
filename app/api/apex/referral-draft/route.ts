import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { HAIKU_MODEL } from "@/lib/ai/anthropic-models"
import { withAICall } from "@/lib/apex/budget/ai-call"
import { isAiBudgetExceeded } from "@/lib/apex/budget/cap"
import type { Company, Job, Profile } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 20

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

function apexError(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReferralConnection = {
  name: string
  their_role_at_company: string
  relationship: string
  warmth: "high" | "medium" | "low"
  last_interaction: string | null
}

export type ReferralDraftResult = {
  channel: "email" | "linkedin"
  subject: string | null
  message_to_connection: string
  forwardable_blurb: string
  tone_note: string
}

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are helping a job seeker ask a personal connection for a referral. You write warm, concise, genuinely human outreach — never transactional, entitled, or templated-sounding.

INPUTS (provided as JSON):
- candidate: { name, current_role, top_strengths }
- target: { company, role_title, job_url }
- connection: { name, their_role_at_company, relationship, warmth: "high" | "medium" | "low", last_interaction }
- application_status: e.g. "applied 8 days ago, no response" or "not yet applied"

RULES:
- Scale tone to warmth. High = familiar and direct, can reference shared history. Medium = friendly but more context-setting. Low = respectful, reintroduce yourself, lower the ask.
- Reference something specific and real from the relationship. Never invent details not present in the inputs; if you lack a specific memory, keep it honest and general.
- Make the ask easy to say yes to and easy to decline. Give a graceful out.
- Keep the message to the connection under ~120 words. No flattery padding.
- The forwardable blurb is written so the connection can paste it to the recruiter or hiring team with zero edits, in their own voice, vouching for the candidate. It should focus on fit (2-4 sentences), not on the candidate's need for a job.
- If application_status shows a stalled application, the ask may be "a quick internal nudge" rather than a fresh referral.

Return ONLY valid JSON, no preamble or markdown:
{
  "channel": "email" | "linkedin",
  "subject": string | null,
  "message_to_connection": string,
  "forwardable_blurb": string,
  "tone_note": string
}`

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apexError(401, "Unauthorized")
  if (!anthropic) return apexError(503, "AI service not configured")

  const body = await request.json().catch(() => null) as {
    jobId: string
    connection: ReferralConnection
    application_status: string
  } | null

  if (!body?.jobId || !body?.connection?.name) {
    return apexError(400, "jobId and connection details are required")
  }

  const pool = getPostgresPool()

  // Fetch job + company, the user's name, and their primary resume in parallel.
  // Skills/role live on the parsed resume — `profiles` only carries full_name.
  const [jobResult, profileResult, resumeResult] = await Promise.all([
    pool.query<Job & { company: Company }>(
      `SELECT j.*, to_jsonb(c.*) AS company
       FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1 LIMIT 1`,
      [body.jobId]
    ),
    pool.query<Pick<Profile, "full_name">>(
      `SELECT full_name FROM profiles WHERE id = $1 LIMIT 1`,
      [user.id]
    ),
    pool.query<{ top_skills: string[] | null; primary_role: string | null }>(
      `SELECT top_skills, primary_role FROM resumes
       WHERE user_id = $1 AND is_primary = true AND parse_status = 'complete'
       ORDER BY updated_at DESC LIMIT 1`,
      [user.id]
    ),
  ])

  const job = jobResult.rows[0]
  const profile = profileResult.rows[0]
  const resume = resumeResult.rows[0]

  if (!job) return apexError(404, "Job not found")

  const candidateName = profile?.full_name ?? "the candidate"
  const topStrengths = (resume?.top_skills ?? []).slice(0, 3).join(", ") || "strong technical background"
  const currentRole = resume?.primary_role || "software professional"

  const inputs = {
    candidate: {
      name: candidateName,
      current_role: currentRole,
      top_strengths: topStrengths,
    },
    target: {
      company: job.company?.name ?? "the company",
      role_title: job.title,
      job_url: job.apply_url ?? "",
    },
    connection: body.connection,
    application_status: body.application_status,
  }

  const { value: result, timedOut } = await withAICall({
    anthropic: anthropic!,
    feature: "apex_follow_up",
    // apex_follow_up's 4s budget is sized for a 2-3 sentence follow-up; this
    // draft generates a full message + forwardable blurb (~600 tokens), which
    // Haiku needs longer for. Give it a realistic ceiling under maxDuration.
    timeoutMs: 14_000,
    params: {
      model: HAIKU_MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(inputs, null, 2) }],
    },
    parse: (text: string) => {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null
      try {
        return JSON.parse(jsonMatch[0]) as ReferralDraftResult
      } catch {
        return null
      }
    },
    fallback: () => null,
    userId: user.id,
  })

  if (!result) {
    if (timedOut) return apexError(504, "The draft took too long to generate. Please try again.")
    if (await isAiBudgetExceeded()) return apexError(503, "Daily AI limit reached. Try again later.")
    return apexError(502, "Couldn't draft the message right now. Please try again.")
  }
  return NextResponse.json({ ok: true, draft: result })
}
