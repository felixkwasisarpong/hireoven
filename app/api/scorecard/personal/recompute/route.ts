import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { getOrComputePersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"


/** Server-side plan gate — this endpoint exposes the paid "personal_scorecard" feature. */
async function requirePlanGate(userId: string) {
  const plan = await getPlanForUserId(userId)
  if (canAccess(plan, "personal_scorecard")) return null
  const needed = requiredPlanFor("personal_scorecard")
  return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const planGate = await requirePlanGate(user.sub)
  if (planGate) return planGate
  try {
    const card = await getOrComputePersonalScorecard(user.sub, { forceRecompute: true })
    if (!card) {
      return NextResponse.json({ error: "no_resume", code: "NO_RESUME" }, { status: 409 })
    }
    return NextResponse.json(card)
  } catch (err) {
    console.error("[scorecard:personal:recompute]", err)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
