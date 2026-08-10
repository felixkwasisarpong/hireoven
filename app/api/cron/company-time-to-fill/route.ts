import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { computeAndStoreTimeToFill } from "@/lib/companies/time-to-fill"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

// Recomputes each company's median days-open from the observed posting lifecycle.
// Moves slowly, so weekly is plenty (harvester crontab):
//   30 4 * * 1   bash scripts/crons.sh company-time-to-fill   (Mon 04:30 UTC)

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const start = Date.now()
  try {
    const { updated } = await computeAndStoreTimeToFill(getPostgresPool())
    return NextResponse.json({ ok: true, updated, duration_ms: Date.now() - start })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - start },
      { status: 500 },
    )
  }
}
