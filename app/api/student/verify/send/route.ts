import { NextResponse } from "next/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { sendStudentOtp } from "@/lib/students/server"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const { userId } = await getUserPlan()
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { email?: string }
  const email = typeof body.email === "string" ? body.email : ""

  const result = await sendStudentOtp({ userId, email })
  if (!result.ok) {
    const status =
      result.code === "RATE_LIMITED" ? 429
      : result.code === "RESEND_NOT_CONFIGURED" ? 503
      : result.code === "EMAIL_DELIVERY_FAILED" ? 502
      : 400
    return NextResponse.json({ error: result.error, code: result.code }, { status })
  }

  return NextResponse.json({ ok: true, expiresAt: result.expiresAt })
}
