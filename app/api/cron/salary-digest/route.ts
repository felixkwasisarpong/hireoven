import { NextResponse } from "next/server"
import { generateDigestForAllActiveUsers } from "@/lib/scout/salary/weekly-digest"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// Runs every Monday at 8am — add to vercel.json cron config:
// { "path": "/api/cron/salary-digest", "schedule": "0 8 * * 1" }

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await generateDigestForAllActiveUsers()
  return NextResponse.json({ ok: true })
}
