import { NextResponse } from "next/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { confirmStudentOtp } from "@/lib/students/server"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const { userId } = await getUserPlan()
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { code?: string }
  const code = typeof body.code === "string" ? body.code : ""

  const result = await confirmStudentOtp({ userId, code })
  if (!result.ok) {
    const status =
      result.code === "ATTEMPTS_EXCEEDED" ? 429
      : result.code === "CODE_EXPIRED" || result.code === "NO_ACTIVE_CODE" ? 410
      : 400
    return NextResponse.json({ error: result.error, code: result.code }, { status })
  }

  return NextResponse.json({ ok: true, email: result.email })
}
