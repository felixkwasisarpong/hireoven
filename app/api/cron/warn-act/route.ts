import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { importWarnAct } from "@/lib/layoffs/importers/warn-act"

export const runtime = "nodejs"
export const maxDuration = 300

// Schedule: every 48 hours at 3am UTC

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await importWarnAct()
    return NextResponse.json({ ok: true, source: "warn_act", ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
