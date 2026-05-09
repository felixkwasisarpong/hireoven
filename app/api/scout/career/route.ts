import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireFeature } from "@/lib/gates/server-gate"
import { runCareerEngine } from "@/lib/scout/career/engine"
import { logApiUsage } from "@/lib/admin/usage"
import { sanitizeGeneratedText } from "@/lib/text/sanitize-generated-text"

export const runtime    = "nodejs"
export const maxDuration = 35

export async function POST(request: NextRequest) {
  const gate = await requireFeature("scout_strategy", request)
  if (gate instanceof NextResponse) return gate
  const { userId } = gate
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "AI service not configured" }, { status: 503 })

  const body = await request.json().catch(() => ({})) as { message?: string }
  const objective = body.message?.trim()

  if (!objective) return NextResponse.json({ error: "message is required" }, { status: 400 })

  try {
    const { getPostgresPool } = await import("@/lib/postgres/server")
    const pool = getPostgresPool()

    const result = await runCareerEngine(objective, userId, pool)

    await logApiUsage({
      service:     "claude",
      operation:   "scout_career_strategy",
      tokens_used: 0,
      cost_usd:    0,
    }).catch(() => {})

    return NextResponse.json(sanitizeGeneratedText(result))
  } catch (err) {
    console.error("[scout:career] engine error:", err)
    return NextResponse.json({ error: "Career analysis failed. Please try again." }, { status: 500 })
  }
}
