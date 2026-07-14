import { NextResponse } from "next/server"
import { generateDigestForAllActiveUsers } from "@/lib/apex/salary/weekly-digest"
import { requireCronAuth } from "@/lib/env"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// Runs every Monday at 8am — add to vercel.json cron config:
// { "path": "/api/cron/salary-digest", "schedule": "0 8 * * 1" }

export async function GET(request: Request) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await generateDigestForAllActiveUsers()
  return NextResponse.json({ ok: true })
}
