import { NextResponse } from "next/server"
import { deliverDueInterviewReminders } from "@/lib/interview/reminder-delivery"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Runs every 5 minutes
// { "path": "/api/cron/interview-reminders", "schedule": "*/5 * * * *" }

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await deliverDueInterviewReminders()
  return NextResponse.json({ ok: true, ...result })
}
