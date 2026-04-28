import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logApiUsage } from "@/lib/admin/usage"
import { getUserPlan } from "@/lib/gates/server-gate"
import { canAccess } from "@/lib/gates"
import { getPostgresPool } from "@/lib/postgres/server"
import { analyzeFollowUp } from "@/lib/scout/follow-up"
import type { JobApplication } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 20

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// Using Haiku for short drafts — cheap, fast, sufficient
const MODEL = "claude-haiku-4-5"
const MODEL_PRICING = { inputPerMillion: 0.25, outputPerMillion: 1.25 }

const DRAFT_SYSTEM = `You are helping a job candidate write a short, professional follow-up message.

Rules:
- Do NOT invent recruiter names. Address the message generically.
- Do NOT claim the candidate interviewed unless the application status says so.
- Keep the message to 2–3 sentences maximum — no fluff.
- Tone: warm, professional, confident.
- Do not include a subject line.
- Do not add placeholder tokens like "[Your Name]" — write just the message body.
- Return only the message body, nothing else. No preamble, no sign-off.`

async function generateDraft(app: JobApplication): Promise<string | null> {
  if (!anthropic) return null

  const appliedAt = app.applied_at
    ? new Date(app.applied_at).toLocaleDateString("en-US", { month: "long", day: "numeric" })
    : "recently"

  const statusContext =
    app.status === "interview" || app.status === "final_round"
      ? "The candidate recently completed an interview."
      : app.status === "phone_screen"
      ? "The candidate recently completed a phone screen."
      : `The candidate submitted an application on ${appliedAt}.`

  const userMessage = `Write a follow-up email body for this situation:
- Role: ${app.job_title} at ${app.company_name}
- Status: ${app.status.replace(/_/g, " ")}
- ${statusContext}

2–3 sentences max.`

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 280,
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    })

    const inputTokens = message.usage?.input_tokens ?? 0
    const outputTokens = message.usage?.output_tokens ?? 0
    const costUsd =
      (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
      (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion

    await logApiUsage({
      service: "claude",
      operation: "scout_follow_up_draft",
      tokens_used: inputTokens + outputTokens,
      cost_usd: Number(costUsd.toFixed(6)),
    })

    return message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
  } catch (err) {
    console.error("[follow-up] draft generation error:", err)
    return null
  }
}

// ── POST /api/scout/follow-up ─────────────────────────────────────────────────

type RequestBody = {
  applicationId?: string
  jobId?: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody
  const { applicationId, jobId } = body

  if (!applicationId && !jobId) {
    return NextResponse.json(
      { error: "applicationId or jobId is required" },
      { status: 400 }
    )
  }

  // Fetch application — must belong to user
  const pool = getPostgresPool()
  let app: JobApplication | null = null

  try {
    if (applicationId) {
      const result = await pool.query<JobApplication>(
        `SELECT ja.*, c.domain AS company_domain
         FROM job_applications ja
         LEFT JOIN companies c ON c.id = ja.company_id
         WHERE ja.id = $1 AND ja.user_id = $2 AND ja.is_archived = false
         LIMIT 1`,
        [applicationId, user.id]
      )
      app = result.rows[0] ?? null
    } else {
      const result = await pool.query<JobApplication>(
        `SELECT * FROM job_applications
         WHERE job_id = $1 AND user_id = $2 AND is_archived = false
         ORDER BY created_at DESC LIMIT 1`,
        [jobId, user.id]
      )
      app = result.rows[0] ?? null
    }
  } catch (err) {
    console.error("[follow-up] DB query error:", err)
    return NextResponse.json({ error: "Failed to fetch application." }, { status: 500 })
  }

  if (!app) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 })
  }

  const analysis = analyzeFollowUp(app)

  // Draft is pro-only — only call Claude when it's worth it (status=ready)
  const { plan } = await getUserPlan(request)
  const isPro = canAccess(plan, "interview_prep")

  let draft: string | null = null
  let gated = false

  if (analysis.status === "ready") {
    if (isPro) {
      draft = await generateDraft(app)
    } else {
      gated = true
    }
  }

  return NextResponse.json({
    status: analysis.status,
    recommendation: analysis.recommendation,
    reasons: analysis.reasons,
    daysStale: analysis.daysStale,
    urgency: analysis.urgency,
    draft,
    gated,
  })
}
