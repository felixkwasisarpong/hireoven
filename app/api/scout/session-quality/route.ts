import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"

type SessionQualityPayload = {
  sessionId: string
  durationSeconds: number
  actionsCount: number
  applyAttempts: number
  savedJobs: number
  searchQueries: number
  modeChanges: number
}

function classifySessionQuality(payload: SessionQualityPayload): "deep" | "moderate" | "passive" | "bounce" {
  const { durationSeconds, actionsCount, applyAttempts, savedJobs } = payload
  const meaningfulActions = applyAttempts + savedJobs

  if (durationSeconds < 120) return "bounce"
  if (durationSeconds >= 600 && meaningfulActions >= 3) return "deep"
  if (durationSeconds >= 300 && meaningfulActions >= 1) return "moderate"
  return "passive"
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ ok: false }) }

  const payload = body as Partial<SessionQualityPayload>
  if (!payload.sessionId || typeof payload.durationSeconds !== "number") {
    return NextResponse.json({ ok: false })
  }

  const full: SessionQualityPayload = {
    sessionId: payload.sessionId,
    durationSeconds: payload.durationSeconds,
    actionsCount: payload.actionsCount ?? 0,
    applyAttempts: payload.applyAttempts ?? 0,
    savedJobs: payload.savedJobs ?? 0,
    searchQueries: payload.searchQueries ?? 0,
    modeChanges: payload.modeChanges ?? 0,
  }

  const quality = classifySessionQuality(full)

  try {
    const pool = getPostgresPool()
    await pool.query(
      `INSERT INTO public.user_session_quality
         (user_id, session_id, duration_seconds, actions_count, apply_attempts,
          saved_jobs, search_queries, mode_changes, session_quality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING`,
      [user.id, full.sessionId, full.durationSeconds, full.actionsCount,
       full.applyAttempts, full.savedJobs, full.searchQueries, full.modeChanges, quality]
    )
    return NextResponse.json({ ok: true, quality })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
