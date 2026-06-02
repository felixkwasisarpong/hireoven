import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildCareerTwinSnapshot, ensureFreshCareerTwin } from "@/lib/apex/career-twin/builder"
import { getLatestCareerTwin, listCareerTwinSnapshots } from "@/lib/apex/career-twin/store"
import type { CareerTwinBuildReason } from "@/lib/apex/career-twin/types"

export const runtime = "nodejs"
export const maxDuration = 30

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return jsonError(401, "Unauthorized")

  const pool = getPostgresPool()
  const { searchParams } = request.nextUrl
  const fresh = searchParams.get("fresh") === "1"
  const includeHistory = searchParams.get("history") === "1"
  const hoursRaw = Number(searchParams.get("hours") ?? "24")
  const maxAgeHours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(hoursRaw, 168)) : 24

  try {
    const twin = fresh
      ? await ensureFreshCareerTwin(user.id, {
          maxAgeHours,
          reason: "api_read_through",
        })
      : await getLatestCareerTwin(user.id, pool)

    if (!twin) {
      return NextResponse.json({ twin: null, history: [] })
    }

    const history = includeHistory ? await listCareerTwinSnapshots(user.id, pool, 5) : []
    return NextResponse.json({ twin, history })
  } catch (error) {
    console.error("[apex/career-twin] GET error", error)
    return jsonError(500, "Unable to load Career Twin right now.")
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return jsonError(401, "Unauthorized")

  const body = (await request.json().catch(() => null)) as { reason?: CareerTwinBuildReason } | null
  const allowedReasons = new Set<CareerTwinBuildReason>([
    "manual_refresh",
    "strategy_request",
    "api_read_through",
    "background_refresh",
  ])

  const reason = body?.reason && allowedReasons.has(body.reason) ? body.reason : "manual_refresh"

  try {
    const twin = await buildCareerTwinSnapshot(user.id, reason)
    return NextResponse.json({ twin, rebuilt: true })
  } catch (error) {
    console.error("[apex/career-twin] POST error", error)
    return jsonError(500, "Unable to rebuild Career Twin right now.")
  }
}
