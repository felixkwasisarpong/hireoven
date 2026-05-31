import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { HAIKU_MODEL } from "@/lib/ai/anthropic-models"
import { getDebrief, getInterviewSession } from "@/lib/apex/interview/queries"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"
import { replaceEmDash, sanitizeGeneratedText } from "@/lib/text/sanitize-generated-text"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    fromSessionId?: string
    gapIndex?: number
    practiceType?: "text" | "live"
    durationMin?: number
  }

  if (!body.fromSessionId || body.gapIndex == null || !body.practiceType) {
    return NextResponse.json({ error: "fromSessionId, gapIndex, and practiceType are required" }, { status: 400 })
  }
  const feature = body.practiceType === "live" ? "interview_live" : "interview_prep"
  const plan = await getPlanForUserId(user.id)
  if (!canAccess(plan, feature)) {
    const needed = requiredPlanFor(feature)
    return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
  }

  const durationMin = [10, 15].includes(body.durationMin ?? 0) ? body.durationMin! : 10

  // Load source session + debrief
  const sourceSession = await getInterviewSession(body.fromSessionId, user.id)
  if (!sourceSession) return NextResponse.json({ error: "Source session not found" }, { status: 404 })

  const debrief = await getDebrief(body.fromSessionId)
  if (!debrief) return NextResponse.json({ error: "No debrief found for source session" }, { status: 404 })

  const gaps = debrief.gaps as Array<{ observation: string; suggestion: string; quote: string }>
  const gap = gaps[body.gapIndex]
  if (!gap) return NextResponse.json({ error: "Gap not found at that index" }, { status: 400 })

  // Derive skill tags via Haiku
  let practiceTags: string[] = []
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const res = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 60,
      messages: [{
        role: "user",
        content: `Extract 3 short skill tags (1-3 words each) that an interviewer should probe to test whether this candidate has fixed this specific weakness.

Weakness: ${gap.observation}
Fix: ${gap.suggestion}

Output a JSON array of 3 strings. No other text.`,
      }],
    })
    const text = (res.content[0] as { type: string; text: string }).text.trim()
    const parsed = JSON.parse(text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, ""))
    if (Array.isArray(parsed)) practiceTags = parsed.slice(0, 3).map((item) => replaceEmDash(String(item)))
  } catch {
    practiceTags = ["impact metrics", "ownership clarity", "tradeoff articulation"]
  }

  // Create the practice session
  const pool = getPostgresPool()
  const practiceFocus = {
    observation: gap.observation,
    suggestion: gap.suggestion,
    source_quote: gap.quote ?? "",
    derived_skills: practiceTags,
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO interview_sessions
       (user_id, job_id, type, persona, question_set, duration_target_min, use_resume_context, metadata)
     VALUES ($1, $2, $3::interview_type, $4::interview_persona, $5::interview_question_set, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      user.id,
      sourceSession.jobId,
      body.practiceType,
      sourceSession.persona,
      sourceSession.questionSet,
      durationMin,
      sourceSession.useResumeContext,
      JSON.stringify({ practice_focus: practiceFocus }),
    ]
  )

  const sessionId = result.rows[0].id
  const redirectTo = `/dashboard/interview/${body.practiceType}/${sessionId}`

  return NextResponse.json(sanitizeGeneratedText({ sessionId, redirectTo }), { status: 201 })
}
