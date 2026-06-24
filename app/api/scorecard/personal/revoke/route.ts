import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { revokePersonalShare } from "@/lib/scorecard/personal-scorecard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const result = await revokePersonalShare(user.sub)
    return NextResponse.json(result)
  } catch (err) {
    console.error("[scorecard:personal:revoke]", err)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
