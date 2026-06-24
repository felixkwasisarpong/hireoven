import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { getOrComputePersonalScorecard } from "@/lib/scorecard/personal-scorecard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
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
