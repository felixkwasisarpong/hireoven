import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"
import { requireQuota } from "@/lib/usage/server-quota"
import {
  getInterviewSession,
  appendTurn,
  getTurns,
} from "@/lib/scout/interview/queries"
import { buildInterviewContext } from "@/lib/scout/interview/context"
import { buildCodingInterviewerSystemPrompt } from "@/lib/scout/interview/agentPrompts"
import { replaceEmDash, sanitizeGeneratedText } from "@/lib/text/sanitize-generated-text"

export const runtime = "nodejs"
export const maxDuration = 60

type Trigger = "candidate_message" | "hint_request" | "idle_timeout" | "failed_run" | "time_warning" | "submit_walkthrough"

function stripMetadata(raw: string) {
  return raw.replace(/<metadata>[\s\S]*?<\/metadata>/g, "").trim()
}

const TRIGGER_SYSTEM_MESSAGES: Record<Trigger, (extra?: string) => string> = {
  candidate_message: () => "",  // candidate message is the content itself
  hint_request:      () => "[TRIGGER: hint_request]",
  idle_timeout:      () => "[TRIGGER: idle_timeout] No code change in 2 minutes.",
  failed_run:        (r) => `[TRIGGER: failed_run] Test run results: ${r ?? "some tests failed"}.`,
  time_warning:      (t) => `[TRIGGER: time_warning] ${t ?? "80% of target time elapsed"}.`,
  submit_walkthrough:(r) => `[TRIGGER: submit_walkthrough] Submission results: ${r ?? "submitted"}.`,
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const plan = await getPlanForUserId(user.id)
  if (!canAccess(plan, "interview_prep")) {
    const needed = requiredPlanFor("interview_prep")
    return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
  }

  const pool = getPostgresPool()
  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.status === "abandoned") {
    return NextResponse.json({ error: "Session is abandoned" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({})) as {
    trigger: Trigger
    content?: string
    testResults?: unknown
  }

  const { trigger, content } = body

  // Load attempt + problem for context
  const attemptResult = await pool.query<Record<string, unknown>>(
    `SELECT ca.*, cp.hints, cp.title, cp.difficulty, cp.target_minutes, cp.tags
     FROM coding_attempts ca
     JOIN coding_problems cp ON cp.id = ca.problem_id
     WHERE ca.session_id = $1
     LIMIT 1`,
    [id]
  )
  const attempt = attemptResult.rows[0]
  if (!attempt) return NextResponse.json({ error: "No active attempt" }, { status: 400 })

  const hints = attempt.hints as string[]
  const hintsUsed = (attempt.hints_used as number) ?? 0

  // Handle hint_request directly — no LLM call needed
  if (trigger === "hint_request") {
    let message: string
    if (hintsUsed >= hints.length) {
      message = "You've used all the hints I have. Talk through what's blocking you?"
    } else {
      message = replaceEmDash(hints[hintsUsed])
      await pool.query(
        `UPDATE coding_attempts SET hints_used = hints_used + 1 WHERE id = $1`,
        [attempt.id as string]
      )
    }

    const existingTurns = await getTurns(id)
    await appendTurn({
      sessionId: id,
      turnIndex: existingTurns.length,
      role: "interviewer",
      content: message,
      metadata: { type: "hint", hint_index: hintsUsed },
    })

    return NextResponse.json(sanitizeGeneratedText({
      message,
      hintsUsedSoFar: Math.min(hintsUsed + 1, hints.length),
      hintsRemaining: Math.max(0, hints.length - hintsUsed - 1),
    }))
  }

  // Burn a turn-quota credit only for triggers that actually call the LLM
  // (hint_request returned above without hitting Claude).
  const quota = await requireQuota(user.id, "interview_prep_turn", plan)
  if (quota instanceof NextResponse) return quota

  // Build LLM context
  const context = await buildInterviewContext({
    userId: user.id,
    jobId: session.jobId,
    useResume: session.useResumeContext,
    questionSet: "coding",
  })

  const systemPrompt = buildCodingInterviewerSystemPrompt({
    context,
    persona: session.persona,
    problem: {
      title: attempt.title as string,
      difficulty: attempt.difficulty as string,
      targetMinutes: attempt.target_minutes as number,
      tags: attempt.tags as string[],
    },
    jobTitle: context.jobTitle,
    companyName: context.companyName,
  })

  // Build message history from prior turns
  const existingTurns = await getTurns(id)
  const interviewerTurns = existingTurns.filter((t) => t.role === "interviewer")
  const messages: Array<{ role: "user" | "assistant"; content: string }> = []

  // Reconstruct alternating history
  messages.push({ role: "user", content: "[TRIGGER: session_open]" })
  for (const turn of existingTurns) {
    if (turn.role === "interviewer") {
      messages.push({ role: "assistant", content: turn.content })
    } else if (turn.role === "candidate") {
      messages.push({ role: "user", content: turn.content })
    }
  }

  // Add trigger message
  const triggerExtra = trigger === "failed_run"
    ? JSON.stringify(body.testResults)
    : trigger === "time_warning"
      ? `${Math.ceil((session.durationTargetMin * 60 * 0.2) / 60)} minutes remaining`
      : trigger === "submit_walkthrough"
        ? JSON.stringify(body.testResults)
        : undefined

  const triggerMsg = trigger === "candidate_message" && content
    ? content
    : TRIGGER_SYSTEM_MESSAGES[trigger](triggerExtra)

  // Append to last user message or add new
  const last = messages[messages.length - 1]
  if (last?.role === "user") {
    last.content = trigger === "candidate_message" ? triggerMsg : `${last.content}\n\n${triggerMsg}`
  } else {
    messages.push({ role: "user", content: triggerMsg })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const llmResult = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 500,
    system: systemPrompt,
    messages,
  })

  const rawContent = (llmResult.content[0] as { type: string; text: string }).text
  const visibleContent = replaceEmDash(stripMetadata(rawContent))

  // Save candidate turn if applicable
  let nextTurnIndex = existingTurns.length
  if (trigger === "candidate_message" && content) {
    await appendTurn({
      sessionId: id,
      turnIndex: nextTurnIndex++,
      role: "candidate",
      content,
    })
  }

  await appendTurn({
    sessionId: id,
    turnIndex: nextTurnIndex,
    role: "interviewer",
    content: visibleContent,
    metadata: { trigger },
  })

  const currentHintsUsed = (attempt.hints_used as number) ?? 0

  return NextResponse.json(sanitizeGeneratedText({
    message: visibleContent,
    hintsUsedSoFar: currentHintsUsed,
    hintsRemaining: Math.max(0, hints.length - currentHintsUsed),
  }))
}
