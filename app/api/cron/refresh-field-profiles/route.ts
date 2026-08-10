import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildAndStoreFieldProfiles } from "@/lib/resume/field-profiles"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

// Rebuilds the data-derived field skill profiles from the live job corpus.
// Fields change slowly, so weekly is plenty (harvester crontab):
//   0 23 * * 0   bash scripts/crons.sh refresh-field-profiles   (Sun 23:00 UTC)

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const start = Date.now()
  try {
    const results = await buildAndStoreFieldProfiles(getPostgresPool())
    return NextResponse.json({ ok: true, fields: results, duration_ms: Date.now() - start })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - start },
      { status: 500 },
    )
  }
}
