import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { classifyBurnoutState } from "@/lib/scout/burnout/classifier"
import { executeIntervention } from "@/lib/scout/burnout/interventions"
import type { BurnoutState } from "@/lib/scout/burnout/classifier"

export const dynamic = "force-dynamic"
export const maxDuration = 30

// GET — fetch current burnout state (cached if classified < 24h ago)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ state: null })

  const pool = getPostgresPool()

  // Return cached state if classified in the last 24 hours
  const cached = await pool.query<{
    state: string; confidence: string; signals: unknown
    intervention_type: string; classified_at: string
    days_since_last_application: number | null
    mismatch_score: number | null
  }>(
    `SELECT state, confidence, signals, intervention_type, classified_at
     FROM public.user_burnout_states
     WHERE user_id = $1
       AND classified_at > NOW() - INTERVAL '24 hours'
     ORDER BY classified_at DESC LIMIT 1`,
    [user.id]
  )

  if (cached.rows.length > 0) {
    return NextResponse.json({ state: cached.rows[0], fresh: false })
  }

  // Classify fresh
  try {
    const burnoutState = await classifyBurnoutState(user.id)
    return NextResponse.json({ state: burnoutState, fresh: true })
  } catch {
    return NextResponse.json({ state: null })
  }
}

// POST — explicitly trigger classification + return intervention
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const burnoutState = await classifyBurnoutState(user.id)
    let intervention = null

    if (burnoutState.interventionType !== "none") {
      intervention = await executeIntervention(user.id, burnoutState)
    }

    return NextResponse.json({ burnoutState, intervention })
  } catch (err) {
    console.error("[burnout] classification error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// PATCH — mark an intervention as responded-to
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ ok: false }) }
  const { responseAction } = body as { responseAction?: string }

  const pool = getPostgresPool()
  await pool.query(
    `UPDATE public.user_burnout_states
     SET user_responded = true, response_action = $2
     WHERE user_id = $1
       AND user_responded = false
     ORDER BY classified_at DESC NULLS LAST`,
    [user.id, responseAction ?? "dismissed"]
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
