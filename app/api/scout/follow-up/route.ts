import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { canAccess } from "@/lib/gates"
import { getPostgresPool } from "@/lib/postgres/server"
import { analyzeFollowUp } from "@/lib/scout/follow-up"
import { HAIKU_MODEL } from "@/lib/ai/anthropic-models"
import { withAICall } from "@/lib/scout/budget/ai-call"
import { AI_TIMEOUTS } from "@/lib/scout/budget/router"
import type { JobApplication } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 20

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// Follow-up drafts are short and latency-sensitive; Haiku is sufficient here.
const MODEL = HAIKU_MODEL

function scoutError(status: number, message: string) {
  return NextResponse.json({ ok: false, status, message, error: message }, { status })
}

const DRAFT_SYSTEM = `You are helping a job candidate write a short, professional follow-up message.

Rules:
- Do NOT invent recruiter names. Address the message generically.
- Do NOT claim the candidate interviewed unless the application status says so.
- Keep the message to 2–3 sentences maximum — no fluff.
- Tone: warm, professional, confident.
- Do not include a subject line.
- Do not add placeholder tokens like "[Your Name]" — write just the message body.
- Return only the message body, nothing else. No preamble, no sign-off.`

async function generateDraft(app: JobApplication, userId: string): Promise<string | null> {
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
    const { value } = await withAICall({
      anthropic,
      feature:   "scout_follow_up",
      timeoutMs: AI_TIMEOUTS.scout_follow_up,
      params: {
        model:      MODEL,
        max_tokens: 280,
        system:     DRAFT_SYSTEM,
        messages:   [{ role: "user", content: userMessage }],
      },
      parse:    (text) => text || null,
      fallback: () => null,
      userId,
    })
    return value
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
    return scoutError(401, "Unauthorized")
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody
  const { applicationId, jobId } = body

  if (!applicationId && !jobId) {
    return scoutError(400, "applicationId or jobId is required")
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
    return scoutError(500, "Failed to fetch application.")
  }

  if (!app) {
    return scoutError(404, "Application not found.")
  }

  const analysis = analyzeFollowUp(app)

  // Draft is pro-only — only call Claude when it's worth it (status=ready)
  const { plan } = await getUserPlan(request)
  const isPro = canAccess(plan, "interview_prep")

  let draft: string | null = null
  let gated = false

  if (analysis.status === "ready") {
    if (isPro) {
      draft = await generateDraft(app, user.id)
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
