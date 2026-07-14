import { NextResponse } from "next/server"
import { detectAndCreateCohorts } from "@/lib/cohorts/cohort-detector"
import { requireCronAuth } from "@/lib/env"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await detectAndCreateCohorts()
  return NextResponse.json({ ok: true, ...result })
}
