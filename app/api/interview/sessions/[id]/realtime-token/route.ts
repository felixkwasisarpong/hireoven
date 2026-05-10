import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getInterviewSession } from "@/lib/scout/interview/queries"
import { buildInterviewContext } from "@/lib/scout/interview/context"
import {
  buildTextInterviewerSystemPrompt,
  buildCodingInterviewerSystemPrompt,
} from "@/lib/scout/interview/agentPrompts"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"
import { getBalance, deductCredits } from "@/lib/scout/interview/credits"
import type { InterviewPersona } from "@/lib/scout/interview/queries"

export const runtime = "nodejs"

const OPENAI_REALTIME_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions"
const REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17"

function voiceForPersona(persona: string): string {
  switch (persona as InterviewPersona) {
    case "friendly_recruiter": return "shimmer"
    case "skeptical_hm":       return "ash"
    case "senior_staff":       return "alloy"
    case "founder":            return "verse"
    case "panel":              return "alloy"   // panel: one voice, role-tagged lines
    default:                   return "alloy"
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Live interview requires OPENAI_API_KEY. Set it in your .env.local file." },
      { status: 503 }
    )
  }

  const pool = getPostgresPool()
  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.type !== "live" && session.type !== "coding") {
    return NextResponse.json({ error: "Not a live or coding session" }, { status: 400 })
  }
  if (session.status === "completed" || session.status === "abandoned") {
    return NextResponse.json({ error: "Session is already ended" }, { status: 400 })
  }
  const plan = await getPlanForUserId(user.id)
  const feature = session.type === "live" ? "interview_live" : "interview_prep"
  if (!canAccess(plan, feature)) {
    const needed = requiredPlanFor(feature)
    return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
  }

  // ── Credit check — live sessions only (coding is covered by Pro subscription) ──
  if (session.type === "live") {
    const bal = await getBalance(user.id, plan)
    if (bal.balance < 1) {
      return NextResponse.json(
        {
          error: "Not enough live interview credits.",
          code: "INSUFFICIENT_CREDITS",
          balance: bal.balance,
          needed: 1,
        },
        { status: 402 }
      )
    }
    const deduct = await deductCredits(user.id, id, session.durationTargetMin)
    if (!deduct.ok) {
      return NextResponse.json(
        {
          error: "Not enough live interview credits.",
          code: "INSUFFICIENT_CREDITS",
          balance: deduct.balance,
          needed: deduct.needed,
        },
        { status: 402 }
      )
    }
  }
  // ── End credit check ──────────────────────────────────────────────────────

  // Transition to active
  if (session.status === "setup") {
    await pool.query(
      `UPDATE interview_sessions SET status = 'active', started_at = NOW() WHERE id = $1`,
      [id]
    )
    session.status = "active"
    session.startedAt = new Date()
  }

  // Build system prompt — coding sessions use the coding-specific prompt
  let systemPrompt: string
  if (session.type === "coding") {
    const context = await buildInterviewContext({
      userId: user.id,
      jobId: session.jobId,
      useResume: session.useResumeContext,
      questionSet: "coding",
    })
    // Load the problem from the coding attempt
    const attemptRow = await pool.query<Record<string, unknown>>(
      `SELECT cp.title, cp.difficulty, cp.target_minutes, cp.tags
       FROM coding_attempts ca
       JOIN coding_problems cp ON cp.id = ca.problem_id
       WHERE ca.session_id = $1
       ORDER BY ca.created_at DESC
       LIMIT 1`,
      [id]
    )
    const problem = attemptRow.rows[0]
      ? {
          title: attemptRow.rows[0].title as string,
          difficulty: attemptRow.rows[0].difficulty as string,
          targetMinutes: attemptRow.rows[0].target_minutes as number,
          tags: attemptRow.rows[0].tags as string[],
        }
      : { title: "Coding Problem", difficulty: "medium", targetMinutes: session.durationTargetMin, tags: [] }

    const jobRow = await pool.query<{ title: string; company_name: string }>(
      `SELECT j.title, c.name AS company_name
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1`,
      [session.jobId ?? "00000000-0000-0000-0000-000000000000"]
    ).catch(() => ({ rows: [] as { title: string; company_name: string }[] }))

    systemPrompt = buildCodingInterviewerSystemPrompt({
      context,
      persona: session.persona,
      problem,
      jobTitle: jobRow.rows[0]?.title ?? "Software Engineer",
      companyName: jobRow.rows[0]?.company_name ?? "the company",
      voiceMode: true,
    })
  } else {
    const context = await buildInterviewContext({
      userId: user.id,
      jobId: session.jobId,
      useResume: session.useResumeContext,
      questionSet: session.questionSet,
    })
    systemPrompt = buildTextInterviewerSystemPrompt({
      context,
      persona: session.persona,
      questionSet: session.questionSet,
      durationTargetMin: session.durationTargetMin,
      voiceMode: true,
    })
  }

  const voice = voiceForPersona(session.persona)

  // Issue ephemeral token from OpenAI
  let openaiRes: Response
  try {
    openaiRes = await fetch(OPENAI_REALTIME_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        voice,
        instructions: systemPrompt,
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 800,
        },
        modalities: ["audio", "text"],
      }),
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach OpenAI: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    )
  }

  if (!openaiRes.ok) {
    const body = await openaiRes.text()
    return NextResponse.json(
      { error: `OpenAI returned ${openaiRes.status}: ${body.slice(0, 200)}` },
      { status: 502 }
    )
  }

  const data = await openaiRes.json() as {
    client_secret?: { value?: string; expires_at?: number }
    id?: string
    model?: string
    voice?: string
  }

  const ephemeralToken = data.client_secret?.value
  const expiresAt = data.client_secret?.expires_at ?? Math.floor(Date.now() / 1000) + 60

  if (!ephemeralToken) {
    return NextResponse.json({ error: "No ephemeral token in OpenAI response" }, { status: 502 })
  }

  return NextResponse.json({
    ephemeralToken,
    expiresAt,
    model: REALTIME_MODEL,
    voice,
    sessionConfig: {
      duration_target_min: session.durationTargetMin,
      persona: session.persona,
      panelNote: session.persona === "panel"
        ? "Panel persona uses one voice with role-tagged lines. Two distinct voices coming in a future update."
        : null,
    },
  })
}
