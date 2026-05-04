import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { canAccess } from "@/lib/gates"
import { getScoutContext } from "@/lib/scout/context"
import {
  MOCK_INTERVIEW_SYSTEM_PROMPT,
  TOTAL_QUESTIONS,
  formatMockInterviewContext,
  parseMockInterviewResponse,
} from "@/lib/scout/mock-interview-prompt"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { withAICall } from "@/lib/scout/budget/ai-call"
import { AI_TIMEOUTS } from "@/lib/scout/budget/router"
import type { ScoutMockInterviewTurn } from "@/lib/scout/types"

export const runtime = "nodejs"
export const maxDuration = 30

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// Mock interviews require coherent coaching feedback and stable multi-turn behavior.
const MODEL = SONNET_MODEL

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
    const { value: parsed, timedOut } = await withAICall({
      anthropic,
      feature:   "scout_mock_interview",
      timeoutMs: AI_TIMEOUTS.scout_mock_interview,
      params: {
        model:      MODEL,
        max_tokens: 1200,
        system:     MOCK_INTERVIEW_SYSTEM_PROMPT,
        messages:   [{ role: "user", content: userMessage }],
      },
      parse:    (text) => parseMockInterviewResponse(text),
      fallback: () => null,
      userId:   user.id,
    })

    if (timedOut || !parsed) {
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
