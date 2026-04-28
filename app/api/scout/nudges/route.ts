import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getScoutBehaviorSignals } from "@/lib/scout/behavior"
import { getScoutStrategyBoard } from "@/lib/scout/strategy"
import { getScoutNudges } from "@/lib/scout/nudges"
import { isScoutMode } from "@/lib/scout/types"

export const runtime = "nodejs"

/**
 * GET /api/scout/nudges
 *
 * Query params:
 *   mode      — current Scout mode (default: "scout")
 *   focusMode — "1" if Focus Mode is active (default: "0")
 *
 * Returns: { nudges: ScoutNudge[] }
 *
 * Used by contexts that cannot compute nudges client-side
 * (e.g. ScoutMiniPanel on non-Scout pages).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const rawMode = searchParams.get("mode") ?? "scout"
  const mode = isScoutMode(rawMode) ? rawMode : "scout"
  const isFocusMode = searchParams.get("focusMode") === "1"

  try {
    const pool = getPostgresPool()

    const [signals, board, resumeResult] = await Promise.all([
      getScoutBehaviorSignals(user.id),
      getScoutStrategyBoard(user.id),
      pool.query<{ id: string }>(
        `SELECT id FROM resumes
         WHERE user_id = $1 AND parse_status = 'complete'
         ORDER BY is_primary DESC, updated_at DESC
         LIMIT 1`,
        [user.id]
      ),
    ])

    const resumeId = resumeResult.rows[0]?.id ?? null
    const nudges = getScoutNudges(mode, signals, board, { isFocusMode, resumeId })

    return NextResponse.json({ nudges })
  } catch (err) {
    console.error("Scout nudges error:", err)
    return NextResponse.json({ nudges: [] })
  }
}
