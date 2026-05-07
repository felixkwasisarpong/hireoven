import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import {
  getInterviewSession,
  appendTurn,
  getTurns,
  createCodingAttempt,
  type CodingProblem,
} from "@/lib/scout/interview/queries"
import { selectProblemForSession } from "@/lib/scout/interview/codingSelector"
import { buildInterviewContext } from "@/lib/scout/interview/context"
import { buildCodingInterviewerSystemPrompt } from "@/lib/scout/interview/agentPrompts"

export const runtime = "nodejs"
export const maxDuration = 60

function stripMetadata(raw: string) {
  return raw.replace(/<metadata>[\s\S]*?<\/metadata>/g, "").trim()
}

function safePublicProblem(p: CodingProblem) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    prompt: p.prompt,
    functionSignature: p.functionSignature,
    hintsCount: p.hints.length,
    targetMinutes: p.targetMinutes,
    tags: p.tags,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.type !== "coding") {
    return NextResponse.json({ error: "Not a coding session" }, { status: 400 })
  }
  if (session.status === "completed" || session.status === "abandoned") {
    return NextResponse.json({ error: "Session is already ended" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({})) as {
    preferredLanguage?: "python" | "javascript" | "typescript"
  }
  const language = body.preferredLanguage ?? "python"

  // Idempotent: if attempt already exists, return it
  const existing = await pool.query<Record<string, unknown>>(
    `SELECT ca.*, cp.id AS problem_id_join
     FROM coding_attempts ca
     JOIN coding_problems cp ON cp.id = ca.problem_id
     WHERE ca.session_id = $1
     LIMIT 1`,
    [id]
  )

  if (existing.rows.length > 0) {
    const problemResult = await pool.query<Record<string, unknown>>(
      `SELECT * FROM coding_problems WHERE id = $1`,
      [existing.rows[0].problem_id as string]
    )
    const problem = problemResult.rows[0]
    const turns = await getTurns(id)
    const openingTurn = turns.find((t) => t.role === "interviewer")

    const elapsedSec = session.startedAt
      ? Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
      : 0
    const timeRemainingSec = Math.max(0, (Number(problem.target_minutes) * 60) - elapsedSec)

    return NextResponse.json({
      attempt: {
        id: existing.rows[0].id,
        sessionId: id,
        problemId: existing.rows[0].problem_id,
        languageUsed: existing.rows[0].language_used,
        codeSnapshots: existing.rows[0].code_snapshots ?? [],
        finalCode: existing.rows[0].final_code ?? null,
        testResults: existing.rows[0].test_results ?? null,
        hintsUsed: existing.rows[0].hints_used ?? 0,
        solveTimeSec: existing.rows[0].solve_time_sec ?? null,
        submittedAt: existing.rows[0].submitted_at ?? null,
        createdAt: existing.rows[0].created_at,
      },
      problem: {
        id: problem.id,
        slug: problem.slug,
        title: problem.title,
        difficulty: problem.difficulty,
        prompt: problem.prompt,
        functionSignature: problem.function_signature,
        hintsCount: (problem.hints as unknown[]).length,
        targetMinutes: problem.target_minutes,
        tags: problem.tags,
      },
      openingMessage: openingTurn?.content ?? null,
      timeRemainingSec,
    })
  }

  // Pick problem
  const problem = await selectProblemForSession({
    userId: user.id,
    jobId: session.jobId,
    duration: session.durationTargetMin,
  })

  // Create attempt
  const attempt = await createCodingAttempt({
    sessionId: id,
    problemId: problem.id,
    languageUsed: language,
  })

  // Transition to active
  await pool.query(
    `UPDATE interview_sessions SET status = 'active', started_at = NOW() WHERE id = $1`,
    [id]
  )

  // System turn
  const turns = await getTurns(id)
  await appendTurn({
    sessionId: id,
    turnIndex: turns.length,
    role: "system",
    content: `Coding session started. Problem: ${problem.title} (${problem.difficulty}). Target time: ${problem.targetMinutes} min.`,
  })

  // Generate opening message
  const context = await buildInterviewContext({
    userId: user.id,
    jobId: session.jobId,
    useResume: session.useResumeContext,
    questionSet: "coding",
  })

  const systemPrompt = buildCodingInterviewerSystemPrompt({
    context,
    persona: session.persona,
    problem: { title: problem.title, difficulty: problem.difficulty, targetMinutes: problem.targetMinutes, tags: problem.tags },
    jobTitle: context.jobTitle,
    companyName: context.companyName,
  })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const llmResult = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: "user", content: "[TRIGGER: session_open]" }],
  })

  const rawOpening = (llmResult.content[0] as { type: string; text: string }).text
  const openingMessage = stripMetadata(rawOpening)

  const updatedTurns = await getTurns(id)
  await appendTurn({
    sessionId: id,
    turnIndex: updatedTurns.length,
    role: "interviewer",
    content: openingMessage,
  })

  return NextResponse.json({
    attempt,
    problem: safePublicProblem(problem),
    openingMessage,
    timeRemainingSec: problem.targetMinutes * 60,
  })
}
