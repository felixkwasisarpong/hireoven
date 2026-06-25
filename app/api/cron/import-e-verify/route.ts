import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { importEverifyEmployers } from "@/lib/everify/import"

export const runtime = "nodejs"
export const maxDuration = 300

// Weekly. No-op until EVERIFY_LIST_URL is configured — USCIS has no stable public bulk
// download, so we never flip is_e_verify without an authoritative source (a false flag
// can harm a STEM OPT case).
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await importEverifyEmployers()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
