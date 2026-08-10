import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { mineTransitions } from "@/lib/career/transitions"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

// Accumulates the career transition graph from parsed résumé histories + hire
// outcomes. Idempotent, so daily is fine — the graph just keeps filling in
// (harvester crontab):
//   45 4 * * *   bash scripts/crons.sh mine-transitions   (daily 04:45 UTC)

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const start = Date.now()
  try {
    const result = await mineTransitions(getPostgresPool())
    return NextResponse.json({ ok: true, ...result, duration_ms: Date.now() - start })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - start },
      { status: 500 },
    )
  }
}
