import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { importLayoffData } from "@/lib/layoffs/importers/layoffdata"

export const runtime = "nodejs"
export const maxDuration = 300

// Schedule: daily. WARN notices come from layoffdata.com's public sheets — the old
// DOL page scraper (importWarnAct) is dead (403) and kept only for reference; this
// route now uses the working layoffdata importer.

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await importLayoffData()
    return NextResponse.json({ ok: true, source: "warn_act", ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
