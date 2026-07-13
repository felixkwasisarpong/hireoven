import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { computeVisibilityScore } from "@/lib/brand/visibility-scorer"
import { runBrandAudit, generateWeeklyActions } from "@/lib/brand/audit-engine"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"


/** Server-side plan gate — this endpoint exposes the paid "personal_brand" feature. */
async function requirePlanGate(userId: string) {
  const plan = await getPlanForUserId(userId)
  if (canAccess(plan, "personal_brand")) return null
  const needed = requiredPlanFor("personal_brand")
  return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
}

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const planGate = await requirePlanGate(user.id)
  if (planGate) return planGate

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
