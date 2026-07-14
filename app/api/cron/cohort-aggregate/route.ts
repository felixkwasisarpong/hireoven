import { NextResponse } from "next/server"
import { aggregateAllActiveCohorts } from "@/lib/cohorts/aggregator"
import { requireCronAuth } from "@/lib/env"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: Request) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await aggregateAllActiveCohorts()
  return NextResponse.json({ ok: true })
}
