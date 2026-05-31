import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { canAccess } from "@/lib/gates"
import { requireQuota } from "@/lib/usage/server-quota"
import { getApexContext } from "@/lib/apex/context"
import {
  MOCK_INTERVIEW_SYSTEM_PROMPT,
  TOTAL_QUESTIONS,
  formatMockInterviewContext,
  parseMockInterviewResponse,
} from "@/lib/apex/mock-interview-prompt"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { withAICall } from "@/lib/apex/budget/ai-call"
import { AI_TIMEOUTS } from "@/lib/apex/budget/router"
import { sanitizeGeneratedText } from "@/lib/text/sanitize-generated-text"
import type { ApexMockInterviewTurn } from "@/lib/apex/types"

export const runtime = "nodejs"
export const maxDuration = 30

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// Mock interviews require coherent coaching feedback and stable multi-turn behavior.
const MODEL = SONNET_MODEL

function apexError(status: number, message: string) {
  return NextResponse.json({ ok: false, status, message, error: message }, { status })
}

type RequestBody = {
  sessionId?: string
  jobId?: string
  resumeId?: string
  /** All previous Q&A pairs for the session — client owns state */
  history?: ApexMockInterviewTurn[]
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
    return apexError(401, "Unauthorized")
  }

  if (!anthropic) {
    return apexError(503, "AI service is not configured.")
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
          "Upgrade to Apex Pro to continue the mock interview and get detailed answer feedback.",
      },
      { status: 200 }
    )
  }

  // Free users get one Q1 preview without burning a credit; all other
  // requests count against the monthly interview_prep_turn quota.
  if (isPro || currentAnswer || questionIndex > 1) {
    const quota = await requireQuota(user.id, "interview_prep_turn", plan)
    if (quota instanceof NextResponse) return quota
  }

  // ── Build context ─────────────────────────────────────────────────────────
  const context = await getApexContext({
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
      feature:   "apex_mock_interview",
      timeoutMs: AI_TIMEOUTS.apex_mock_interview,
      params: {
        model:      MODEL,
        max_tokens: 1200,
        // Ephemeral prompt caching — the mock-interview preamble is static
        // and identical across all users; cache it for the 5-min TTL.
        system:     [{ type: "text", text: MOCK_INTERVIEW_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages:   [{ role: "user", content: userMessage }],
      },
      parse:    (text) => parseMockInterviewResponse(text),
      fallback: () => null,
      userId:   user.id,
    })

    if (timedOut || !parsed) {
      return apexError(500, "Apex couldn't generate an interview question right now. Please try again.")
    }

    // Cap totalQuestions for free users to 1 (they can only preview Q1)
    const effectiveTotalQuestions = isPro ? TOTAL_QUESTIONS : 1

    return NextResponse.json(sanitizeGeneratedText({
      question: parsed.question,
      feedback: parsed.feedback ?? null,
      questionIndex: parsed.questionIndex,
      totalQuestions: effectiveTotalQuestions,
      isComplete: parsed.isComplete || (!isPro && parsed.questionIndex >= 1),
      gated: false,
    }))
  } catch (error) {
    console.error("[mock-interview] Claude error:", error)
    return apexError(500, "Apex couldn't generate an interview question right now. Please try again.")
  }
}
