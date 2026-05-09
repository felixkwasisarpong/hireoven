import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import {
  appendTurn,
  getTurns,
  upsertDebrief,
  getInterviewSession,
} from "@/lib/scout/interview/queries"
import { deriveSkillList } from "@/lib/scout/interview/context"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"

export const runtime = "nodejs"
export const maxDuration = 60

type TranscriptEvent = {
  role: "interviewer" | "candidate"
  content: string
  startMs: number
  endMs: number
}

type VoiceTimings = {
  totalDurationMs: number
  candidateSpeakingMs: number
  interviewerSpeakingMs: number
  silenceMs: number
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.status === "abandoned") {
    return NextResponse.json({ error: "Session is abandoned" }, { status: 400 })
  }
  const plan = await getPlanForUserId(user.id)
  const feature = session.type === "live" ? "interview_live" : "interview_prep"
  if (!canAccess(plan, feature)) {
    const needed = requiredPlanFor(feature)
    return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
  }

  const body = await request.json().catch(() => ({})) as {
    events?: TranscriptEvent[]
    voiceTimings?: VoiceTimings
  }

  const events = body.events ?? []
  const voiceTimings = body.voiceTimings ?? null

  // 1. Insert turns in order (offset from existing)
  const existingTurns = await getTurns(id)
  let nextIndex = existingTurns.length

  for (const event of events) {
    await appendTurn({
      sessionId: id,
      turnIndex: nextIndex++,
      role: event.role,
      content: event.content,
      metadata: { startMs: event.startMs, endMs: event.endMs },
    })
  }

  // 2. Batch-tag interviewer turns via LLM
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const interviewerEvents = events
    .map((e, i) => ({ ...e, absoluteIdx: existingTurns.length + i }))
    .filter((e) => e.role === "interviewer")

  if (interviewerEvents.length > 0) {
    try {
      const skillList = deriveSkillList(session.questionSet)
      const transcriptText = events
        .map((e, i) => `[T${existingTurns.length + i}] ${e.role}: ${e.content}`)
        .join("\n")

      const tagRes = await anthropic.messages.create({
        model: SONNET_MODEL,
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `You are reviewing a completed voice interview transcript. For each INTERVIEWER turn, output a JSON object.

Skill list this interview covered: ${skillList.join(", ")}.

Transcript:
${transcriptText}

Output ONLY a JSON array (no other text), one entry per interviewer turn:
[{"turn_index": N, "skill_tag": "...", "follow_up_count": 0, "internal_score": 1, "note": "..."}]
Exact turn_index values from [T...] labels. Only interviewer turns.`,
        }],
      })

      const jsonText = (tagRes.content[0] as { type: string; text: string }).text.trim()
      const tags = JSON.parse(jsonText) as Array<{
        turn_index: number
        skill_tag: string
        follow_up_count: number
        internal_score: number
        note: string
      }>

      const pool = getPostgresPool()
      for (const tag of tags) {
        await pool.query(
          `UPDATE interview_turns
           SET metadata = metadata || $1::jsonb
           WHERE session_id = $2 AND turn_index = $3`,
          [JSON.stringify({
            skill_tag: tag.skill_tag,
            follow_up_count: tag.follow_up_count,
            internal_score: tag.internal_score,
            note: tag.note,
          }), id, tag.turn_index]
        )
      }
    } catch (e) {
      // Tagging failure is non-blocking — transcript still saves
      console.error("[transcript] batch tagging failed:", e)
    }
  }

  // 3. Save voice timings — only mark completed if still active (coding sessions may already be completed)
  const pool = getPostgresPool()
  const metadataUpdate = voiceTimings ? { voiceTimings } : {}
  if (session.status === "active") {
    await pool.query(
      `UPDATE interview_sessions
       SET status = 'completed',
           ended_at = NOW(),
           metadata = metadata || $1::jsonb
       WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(metadataUpdate), id, user.id]
    )
  } else {
    await pool.query(
      `UPDATE interview_sessions SET metadata = metadata || $1::jsonb WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(metadataUpdate), id, user.id]
    )
  }

  const voiceFeedbackVal = voiceTimings
    ? {
        totalDurationMs: voiceTimings.totalDurationMs,
        candidateSpeakingPct: voiceTimings.totalDurationMs > 0
          ? Math.round((voiceTimings.candidateSpeakingMs / voiceTimings.totalDurationMs) * 100)
          : 0,
      }
    : null

  // 4. Upsert debrief — for completed coding sessions, only patch voice_feedback (preserve coding score)
  if (session.status === "active") {
    await upsertDebrief({
      sessionId: id,
      overallScore: null,
      headline: "Debrief pending",
      strengths: [],
      gaps: [],
      sampleBetterAnswers: [],
      voiceFeedback: voiceFeedbackVal,
      recommendedNext: [],
    })
  } else if (voiceFeedbackVal) {
    await pool.query(
      `UPDATE interview_debriefs SET voice_feedback = $1::jsonb WHERE session_id = $2`,
      [JSON.stringify(voiceFeedbackVal), id]
    )
  }

  return NextResponse.json({ debriefUrl: `/dashboard/interview/${id}/debrief` })
}
