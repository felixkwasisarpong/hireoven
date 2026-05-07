import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const pool = getPostgresPool()

  const linkResult = await pool.query<Record<string, unknown>>(
    `SELECT sl.*, s.type, s.persona, s.question_set, s.duration_target_min, s.created_at AS session_date,
            d.overall_score, d.headline, d.strengths, d.gaps, d.sample_better_answers,
            d.coding_feedback, d.voice_feedback, d.recommended_next
     FROM interview_shared_links sl
     JOIN interview_sessions s ON s.id = sl.session_id
     LEFT JOIN interview_debriefs d ON d.session_id = sl.session_id
     WHERE sl.token = $1`,
    [token]
  )

  const link = linkResult.rows[0]
  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 })

  if (link.revoked_at) return NextResponse.json({ error: "This link has been revoked" }, { status: 410 })

  const expiresAt = new Date(link.expires_at as string)
  if (expiresAt < new Date()) return NextResponse.json({ error: "This link has expired" }, { status: 410 })

  // Increment view count
  await pool.query(
    `UPDATE interview_shared_links SET view_count = view_count + 1 WHERE token = $1`,
    [token]
  )

  const redactQuotes = link.redact_quotes as boolean
  const redactVoice = link.redact_voice as boolean

  // Build sanitized debrief
  type Item = Record<string, unknown>
  const sanitizeQuote = (item: Item): Item => {
    if (!redactQuotes) return item
    return { ...item, quote: item.quote ? "[quote redacted]" : "" }
  }

  const strengths = ((link.strengths as Item[]) ?? []).map(sanitizeQuote)
  const gaps = ((link.gaps as Item[]) ?? []).map((g) =>
    redactQuotes ? { ...g, quote: "[quote redacted]" } : g
  )
  const sampleBetterAnswers = ((link.sample_better_answers as Item[]) ?? []).map((a) =>
    redactQuotes
      ? { ...a, your_answer: "[answer redacted]" }
      : a
  )

  return NextResponse.json({
    debrief: {
      overallScore: link.overall_score,
      headline: link.headline,
      strengths,
      gaps,
      sampleBetterAnswers,
      codingFeedback: link.coding_feedback,
      voiceFeedback: redactVoice ? null : link.voice_feedback,
      recommendedNext: link.recommended_next,
    },
    session: {
      type: link.type,
      persona: link.persona,
      questionSet: link.question_set,
      durationTargetMin: link.duration_target_min,
      sessionDate: link.session_date,
      // Sanitized — no company / job specifics
      jobTitle: "Senior engineer role",
      jobCompany: null,
    },
    meta: {
      sharedAt: link.created_at,
      expiresAt: link.expires_at,
    },
  })
}
