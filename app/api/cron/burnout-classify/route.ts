import { NextResponse } from "next/server"
import { classifyAllActiveUsers } from "@/lib/scout/burnout/classifier"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// Runs every 24h — add to vercel.json cron config:
// { "path": "/api/cron/burnout-classify", "schedule": "0 6 * * *" }

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await classifyAllActiveUsers()
  return NextResponse.json({ ok: true })
}
