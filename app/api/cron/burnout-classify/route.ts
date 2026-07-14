import { NextResponse } from "next/server"
import { classifyAllActiveUsers } from "@/lib/apex/burnout/classifier"
import { requireCronAuth } from "@/lib/env"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// Runs every 24h — add to vercel.json cron config:
// { "path": "/api/cron/burnout-classify", "schedule": "0 6 * * *" }

export async function GET(request: Request) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await classifyAllActiveUsers()
  return NextResponse.json({ ok: true })
}
