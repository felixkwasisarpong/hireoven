import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { importLayoffsFyi } from "@/lib/layoffs/importers/layoffs-fyi"

export const runtime = "nodejs"
export const maxDuration = 300

// Schedule: every 24 hours at 2am UTC

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await importLayoffsFyi()
    return NextResponse.json({ ok: true, source: "layoffs_fyi", ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
