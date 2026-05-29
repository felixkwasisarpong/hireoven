import { NextResponse } from "next/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { getStudentStatus } from "@/lib/students/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const { userId } = await getUserPlan()
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const status = await getStudentStatus(userId)
  return NextResponse.json(status)
}
