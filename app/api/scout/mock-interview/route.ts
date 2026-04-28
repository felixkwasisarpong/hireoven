import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logApiUsage } from "@/lib/admin/usage"
import { getUserPlan } from "@/lib/gates/server-gate"
import { canAccess } from "@/lib/gates"
import { getScoutContext } from "@/lib/scout/context"
import {
  MOCK_INTERVIEW_SYSTEM_PROMPT,
  TOTAL_QUESTIONS,
  formatMockInterviewContext,
  parseMockInterviewResponse,
} from "@/lib/scout/mock-interview-prompt"
import type { ScoutMockInterviewTurn } from "@/lib/scout/types"

export const runtime = "nodejs"
export const maxDuration = 30

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const MODEL = "claude-sonnet-4-6"
const MODEL_PRICING = { inputPerMillion: 3, outputPerMillion: 15 }

function scoutError(status: number, message: string) {
  return NextResponse.json({ ok: false, status, message, error: message }, { status })
}

type RequestBody = {
  sessionId?: string
  jobId?: string
  resumeId?: string
  /** All previous Q&A pairs for the session — client owns state */
  history?: ScoutMockInterviewTurn[]
  /** Answer being submitted for the current question (absent on session start) */
  currentAnswer?: string
  /** 1-indexed question number we expect next (1 = start new session) */
  questionIndex?: number
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return scoutError(401, "Unauthorized")
  }

  if (!anthropic) {
    return scoutError(503, "AI service is not configured.")
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody
  const {
    jobId,
    resumeId,
    history = [],
    currentAnswer,
    questionIndex = 1,
  } = body

  // ── Gating ────────────────────────────────────────────────────────────────
  // Free users can preview Q1 (questionIndex === 1, no currentAnswer).
  // Submitting any answer requires pro.
  const { plan } = await getUserPlan(request)
  const isPro = canAccess(plan, "interview_prep")

  if (currentAnswer && !isPro) {
    return NextResponse.json(
      {
        gated: true,
        feature: "interview_prep",
        upgradeMessage:
          "Upgrade to Scout Pro to continue the mock interview and get detailed answer feedback.",
      },
      { status: 200 }
    )
  }

  // ── Build context ─────────────────────────────────────────────────────────
  const context = await getScoutContext({
    userId: user.id,
    mode: "job",
    jobId: jobId ?? undefined,
    resumeId: resumeId ?? undefined,
  })

  const userMessage = formatMockInterviewContext(
    context,
    history,
    currentAnswer,
    questionIndex
  )

  // ── Call Claude ───────────────────────────────────────────────────────────
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: MOCK_INTERVIEW_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })

    const inputTokens = message.usage?.input_tokens ?? 0
    const outputTokens = message.usage?.output_tokens ?? 0
    const costUsd =
      (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
      (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion

    await logApiUsage({
      service: "claude",
      operation: "scout_mock_interview",
      tokens_used: inputTokens + outputTokens,
      cost_usd: Number(costUsd.toFixed(6)),
    })

    const responseText = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim()

    const parsed = parseMockInterviewResponse(responseText)

    if (!parsed) {
      console.error(
        "[mock-interview] parseMockInterviewResponse returned null.",
        `stop_reason=${message.stop_reason}`,
        "\nRaw:\n",
        responseText.slice(0, 1000)
      )
      return scoutError(500, "Scout couldn't generate an interview question right now. Please try again.")
    }

    // Cap totalQuestions for free users to 1 (they can only preview Q1)
    const effectiveTotalQuestions = isPro ? TOTAL_QUESTIONS : 1

    return NextResponse.json({
      question: parsed.question,
      feedback: parsed.feedback ?? null,
      questionIndex: parsed.questionIndex,
      totalQuestions: effectiveTotalQuestions,
      isComplete: parsed.isComplete || (!isPro && parsed.questionIndex >= 1),
      gated: false,
    })
  } catch (error) {
    console.error("[mock-interview] Claude error:", error)
    return scoutError(500, "Scout couldn't generate an interview question right now. Please try again.")
  }
}
