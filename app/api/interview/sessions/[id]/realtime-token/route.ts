import { NextRequest, NextResponse } from "next/server"
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getInterviewSession } from "@/lib/apex/interview/queries"
import { buildInterviewContext } from "@/lib/apex/interview/context"
import {
  buildTextInterviewerSystemPrompt,
  buildCodingInterviewerSystemPrompt,
} from "@/lib/apex/interview/agentPrompts"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"
import { getBalance, deductCredits } from "@/lib/apex/interview/credits"
import type { InterviewPersona } from "@/lib/apex/interview/queries"

export const runtime = "nodejs"

const OPENAI_REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime"
const REALTIME_TRANSCRIBE_MODEL = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe"

function readOpenAIKeyFromEnvLocal(): string | null {
  // Dev-only fallback: helps when the runtime env is stale and .env.local was edited.
  if (process.env.NODE_ENV !== "development") return null
  try {
    const envPath = path.join(process.cwd(), ".env.local")
    const text = fs.readFileSync(envPath, "utf8")
    const line = text
      .split("\n")
      .find((l) => l.trimStart().startsWith("OPENAI_API_KEY="))
    if (!line) return null
    const raw = line.slice(line.indexOf("=") + 1).trim()
    const unquoted = raw.replace(/^['"]|['"]$/g, "")
    return unquoted.length > 0 ? unquoted : null
  } catch {
    return null
  }
}

function resolveOpenAIKey(): string | null {
  const fromProcess =
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_KEY?.trim() ||
    process.env.OPENAI_LIVE_API_KEY?.trim() ||
    null
  if (fromProcess) return fromProcess
  return readOpenAIKeyFromEnvLocal()
}

function parseOpenAIError(body: string): string {
  const fallback = body.trim() || "Unknown OpenAI error"
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    const msg = parsed.error?.message?.trim()
    return msg || fallback
  } catch {
    return fallback
  }
}

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

  const openaiApiKey = resolveOpenAIKey()
  if (!openaiApiKey) {
    return NextResponse.json(
      {
        error:
          "Live interview requires OPENAI_API_KEY in server runtime. " +
          "If you just edited .env.local, restart your dev server and retry.",
      },
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

  // Issue ephemeral token from OpenAI (GA Realtime API)
  let openaiRes: Response
  try {
    openaiRes = await fetch(OPENAI_REALTIME_CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: systemPrompt,
          output_modalities: ["audio"],
          audio: {
            output: { voice },
            input: {
              transcription: { model: REALTIME_TRANSCRIBE_MODEL },
              turn_detection: {
                // Semantic VAD is less eager to cut in on short pauses/noise.
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                interrupt_response: false,
              },
            },
          },
        },
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
    const message = parseOpenAIError(body)
    return NextResponse.json(
      { error: `OpenAI returned ${openaiRes.status}: ${message.slice(0, 220)}` },
      { status: 502 }
    )
  }

  const data = await openaiRes.json() as {
    value?: string
    expires_at?: number
    client_secret?: { value?: string; expires_at?: number }
    session?: {
      model?: string
      client_secret?: { value?: string; expires_at?: number }
    }
  }

  const ephemeralToken =
    data.value ??
    data.client_secret?.value ??
    data.session?.client_secret?.value
  const expiresAt =
    data.expires_at ??
    data.client_secret?.expires_at ??
    data.session?.client_secret?.expires_at ??
    Math.floor(Date.now() / 1000) + 60

  if (!ephemeralToken) {
    return NextResponse.json({ error: "No ephemeral token in OpenAI response" }, { status: 502 })
  }

  return NextResponse.json({
    ephemeralToken,
    expiresAt,
    model: data.session?.model ?? REALTIME_MODEL,
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
