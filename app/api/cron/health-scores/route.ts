import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { computeHealthScoreForAll } from "@/lib/health/score-computer"

export const runtime = "nodejs"
export const maxDuration = 300

// Schedule: every 48 hours

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await computeHealthScoreForAll()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
