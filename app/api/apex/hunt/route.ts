import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildAutonomousHuntPlan } from "@/lib/apex/hunt/planner"
import { canAccess, requiredPlanFor } from "@/lib/gates"
import { gateResponse, getPlanForUserId } from "@/lib/gates/server-gate"


/** Server-side plan gate — this endpoint exposes the paid "apex_strategy" feature. */
async function requirePlanGate(userId: string) {
  const plan = await getPlanForUserId(userId)
  if (canAccess(plan, "apex_strategy")) return null
  const needed = requiredPlanFor("apex_strategy")
  return gateResponse(403, `This feature requires the ${needed} plan`, needed ?? undefined)
}

export const runtime = "nodejs"
export const maxDuration = 30

function apexError(status: number, message: string) {
  return NextResponse.json({ ok: false, status, error: message }, { status })
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apexError(401, "Unauthorized")
  }
  const planGate = await requirePlanGate(user.id)
  if (planGate) return planGate

  try {
    const plan = await buildAutonomousHuntPlan(user.id)
    return NextResponse.json({ plan })
  } catch (error) {
    console.error("[apex/hunt] GET error", error)
    return apexError(500, "Autonomous Hunt is unavailable right now.")
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apexError(401, "Unauthorized")
  }
  const planGate = await requirePlanGate(user.id)
  if (planGate) return planGate

  try {
    const body = (await request.json().catch(() => ({}))) as { message?: string }
    const plan = await buildAutonomousHuntPlan(user.id, body.message)
    return NextResponse.json({ plan })
  } catch (error) {
    console.error("[apex/hunt] POST error", error)
    return apexError(500, "Autonomous Hunt could not prepare a plan right now.")
  }
}
