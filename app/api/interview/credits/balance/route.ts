import { NextResponse } from "next/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { getBalance, creditsForDuration } from "@/lib/scout/interview/credits"

export const runtime = "nodejs"

export async function GET() {
  const { userId, plan } = await getUserPlan()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const balance = await getBalance(userId, plan)

  return NextResponse.json({
    balance: balance.balance,
    pendingProMaxGrant: balance.pendingProMaxGrant,
    lastGrantAt: balance.lastGrantAt,
    // Convenience: cost per duration so the UI can show what a session will cost
    costs: {
      short: creditsForDuration(30),  // ≤30 min
      long:  creditsForDuration(60),  // ≤60 min
    },
  })
}
