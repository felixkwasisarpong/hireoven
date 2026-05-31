import { NextResponse } from "next/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { getBalance, creditsForDuration } from "@/lib/apex/interview/credits"

export const runtime = "nodejs"

export async function GET() {
  const { userId, plan } = await getUserPlan()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { balance, pendingProMaxGrant } = await getBalance(userId, plan)

  return NextResponse.json({
    balance,
    pendingProMaxGrant,
    costs: {
      short: creditsForDuration(30),
    },
  })
}
