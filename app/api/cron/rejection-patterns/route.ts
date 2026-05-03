import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { recomputeStalePatterns } from "@/lib/rejections/pattern-computer"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await recomputeStalePatterns()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
