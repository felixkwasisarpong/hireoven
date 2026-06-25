import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { reclassifyAllCapExempt } from "@/lib/cap-exempt/reclassify"

export const runtime = "nodejs"
export const maxDuration = 300

// Nightly. Idempotent re-classification of cap-exempt status over all companies.
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await reclassifyAllCapExempt()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
