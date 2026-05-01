/**
 * POST /api/scout/outcomes/reaction
 *
 * Records a lightweight user reaction to a learning signal.
 * One reaction per (user, signal_id) — subsequent calls update it (upsert).
 *
 * Used by the reaction buttons in the ApplicationMode and strategy views.
 * Not a survey. Not a rating system. Just a thumbs signal.
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { randomUUID } from "crypto"
import type { ScoutSignalReaction } from "@/lib/scout/outcomes/types"

export const runtime = "nodejs"

const VALID_REACTIONS = new Set<ScoutSignalReaction>([
  "helpful", "not_helpful", "got_interview", "applied", "rejected", "ignore",
])

type Body = {
  signalId: string
  reaction: ScoutSignalReaction
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body?.signalId || !body?.reaction) {
    return NextResponse.json({ error: "signalId and reaction are required" }, { status: 400 })
  }
  if (!VALID_REACTIONS.has(body.reaction)) {
    return NextResponse.json({ error: "Invalid reaction" }, { status: 400 })
  }

  const pool = getPostgresPool()

  await pool.query(
    `INSERT INTO scout_signal_reactions (id, user_id, signal_id, reaction, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, signal_id)
     DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()`,
    [randomUUID(), user.id, body.signalId, body.reaction],
  ).catch((err) => {
    console.error("[scout/outcomes/reaction] upsert failed", err)
    throw err
  })

  return NextResponse.json({ ok: true })
}
