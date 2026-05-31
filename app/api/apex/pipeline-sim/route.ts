import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { runPipelineSimulation, type FunnelMetrics } from "@/lib/apex/pipeline-sim/simulator"

function err(status: number, msg: string) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * POST /api/apex/pipeline-sim
 * Body: Partial<FunnelMetrics> — fills in zeros for missing fields
 *
 * Can also GET to auto-derive metrics from the user's application history.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, "Unauthorized")

  const body = await req.json().catch(() => ({}))
  const metrics: FunnelMetrics = {
    applicationsSent:    body.applicationsSent    ?? 0,
    responsesReceived:   body.responsesReceived    ?? 0,
    phoneScreens:        body.phoneScreens         ?? 0,
    onsiteInterviews:    body.onsiteInterviews      ?? 0,
    offersReceived:      body.offersReceived        ?? 0,
    appsPerWeek:         body.appsPerWeek          ?? 3,
    weeksElapsed:        body.weeksElapsed         ?? 0,
  }
  return NextResponse.json(runPipelineSimulation(metrics))
}

/** GET /api/apex/pipeline-sim — derive metrics from user's actual application data */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, "Unauthorized")

  // Derive funnel metrics from real application data (via postgres pool —
  // the server supabase client is auth-only in this codebase).
  let all: Array<{ status: string; created_at: string }> = []
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ status: string; created_at: string }>(
      `SELECT status, created_at FROM job_applications WHERE user_id = $1`,
      [user.id],
    )
    all = rows
  } catch {
    all = []
  }
  const now  = new Date()
  const oldest = all.length > 0 ? new Date(all.reduce((min, a) => a.created_at < min ? a.created_at : min, all[0].created_at)) : now
  const weeksElapsed = Math.max(1, Math.round((now.getTime() - oldest.getTime()) / (7 * 24 * 3600 * 1000)))

  const statusMap: Record<string, number> = {}
  for (const a of all) statusMap[a.status] = (statusMap[a.status] ?? 0) + 1

  const metrics: FunnelMetrics = {
    applicationsSent:  all.length,
    responsesReceived: (statusMap["interviewing"] ?? 0) + (statusMap["offer"] ?? 0) + (statusMap["phone_screen"] ?? 0),
    phoneScreens:      statusMap["phone_screen"] ?? 0,
    onsiteInterviews:  statusMap["interviewing"] ?? 0,
    offersReceived:    statusMap["offer"] ?? 0,
    appsPerWeek:       weeksElapsed > 0 ? Math.round(all.length / weeksElapsed) : 3,
    weeksElapsed,
  }

  return NextResponse.json({ metrics, simulation: runPipelineSimulation(metrics) })
}
