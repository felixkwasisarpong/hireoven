import { NextRequest, NextResponse } from "next/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { FEATURE_QUOTAS } from "@/lib/usage/quotas"
import { getAllQuotas } from "@/lib/usage/quotas-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const { userId, plan } = await getUserPlan(request)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const quotas = await getAllQuotas(userId, plan)
  return NextResponse.json({
    plan: plan ?? "free",
    quotas,
    config: FEATURE_QUOTAS,
  })
}
