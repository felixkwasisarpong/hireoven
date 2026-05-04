import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { computeVisibilityScore } from "@/lib/brand/visibility-scorer"
import { runBrandAudit, generateWeeklyActions } from "@/lib/brand/audit-engine"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const score = await computeVisibilityScore(user.id)
    const auditItems = await runBrandAudit(user.id, score)
    const weeklyActions = await generateWeeklyActions(user.id, score, auditItems)
    return NextResponse.json({ score, auditItems, weeklyActions })
  } catch (err) {
    console.error("[brand/score] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to compute score" }, { status: 500 })
  }
}
