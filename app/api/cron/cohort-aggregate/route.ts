import { NextResponse } from "next/server"
import { aggregateAllActiveCohorts } from "@/lib/cohorts/aggregator"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await aggregateAllActiveCohorts()
  return NextResponse.json({ ok: true })
}
