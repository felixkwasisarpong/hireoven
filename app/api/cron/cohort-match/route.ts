import { NextResponse } from "next/server"
import { matchCohortsToOpenRoles } from "@/lib/cohorts/employer-matcher"
import { requireCronAuth } from "@/lib/env"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: Request) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await matchCohortsToOpenRoles()
  return NextResponse.json({ ok: true })
}
