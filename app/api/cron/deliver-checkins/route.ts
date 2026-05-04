import { NextResponse } from "next/server"
import { deliverPendingCheckins } from "@/lib/checkins/delivery-engine"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Runs every 24h at 9am UTC
// { "path": "/api/cron/deliver-checkins", "schedule": "0 9 * * *" }

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await deliverPendingCheckins()
  return NextResponse.json({ ok: true })
}
