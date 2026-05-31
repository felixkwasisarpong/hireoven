import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getApexBehaviorSignals } from "@/lib/apex/behavior"
import { getApexStrategyBoard } from "@/lib/apex/strategy"
import { getApexNudges } from "@/lib/apex/nudges"
import { isApexMode } from "@/lib/apex/types"

export const runtime = "nodejs"

/**
 * GET /api/apex/nudges
 *
 * Query params:
 *   mode      — current Apex mode (default: "apex")
 *   focusMode — "1" if Focus Mode is active (default: "0")
 *
 * Returns: { nudges: ApexNudge[] }
 *
 * Used by contexts that cannot compute nudges client-side
 * (e.g. ApexMiniPanel on non-Apex pages).
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
  const rawMode = searchParams.get("mode") ?? "apex"
  const mode = isApexMode(rawMode) ? rawMode : "apex"
  const isFocusMode = searchParams.get("focusMode") === "1"

  try {
    const pool = getPostgresPool()

    const [signals, board, resumeResult] = await Promise.all([
      getApexBehaviorSignals(user.id),
      getApexStrategyBoard(user.id),
      pool.query<{ id: string }>(
        `SELECT id FROM resumes
         WHERE user_id = $1 AND parse_status = 'complete'
         ORDER BY is_primary DESC, updated_at DESC
         LIMIT 1`,
        [user.id]
      ),
    ])

    const resumeId = resumeResult.rows[0]?.id ?? null
    const nudges = getApexNudges(mode, signals, board, { isFocusMode, resumeId })

    return NextResponse.json({ nudges })
  } catch (err) {
    console.error("Apex nudges error:", err)
    return NextResponse.json({ nudges: [] })
  }
}
