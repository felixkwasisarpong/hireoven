/**
 * POST /api/scout/memory/extract
 *
 * Server-side bulk extraction: derives memory candidates from the user's
 * existing activity (behavior signals, search history, workflow history)
 * and persists those that clear the confidence threshold.
 *
 * Called on first Scout session and on-demand from the Memory panel.
 * Idempotent — deduplication in persistCandidates prevents duplicates.
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getScoutBehaviorSignals } from "@/lib/scout/behavior"
import { extractFromBehaviorSignals } from "@/lib/scout/memory/extractor"
import { persistCandidates, getMemories } from "@/lib/scout/memory/store"
import { MAX_MEMORIES_PER_USER } from "@/lib/scout/memory/types"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  // Abort early if user is already at the memory cap
  const existing = await getMemories(user.id, pool)
  if (existing.length >= MAX_MEMORIES_PER_USER) {
    return NextResponse.json({ extracted: 0, total: existing.length, capped: true })
  }

  // Derive candidates from DB-backed behavior signals
  const signals = await getScoutBehaviorSignals(user.id).catch(() => null)
  const candidates = signals ? extractFromBehaviorSignals(signals) : []

  const written = await persistCandidates(user.id, pool, candidates)

  console.log("[scout:memory:extract]", { userId: user.id, candidates: candidates.length, written })

  return NextResponse.json({
    extracted: written,
    total:     existing.length + written,
    capped:    false,
  })
}
