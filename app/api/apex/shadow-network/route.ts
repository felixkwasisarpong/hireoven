import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { rankConnections, type ShadowConnection } from "@/lib/apex/shadow-network/scorer"
import { generateDM } from "@/lib/apex/shadow-network/outreach"

function err(status: number, msg: string) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * POST /api/apex/shadow-network/rank
 * Body: { connections: ShadowConnection[], jobTitle, companyName }
 * Returns connections scored + sorted by referral likelihood.
 * Called by the Chrome extension after scraping the user's LinkedIn connections.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, "Unauthorized")

  const body = await req.json().catch(() => null)
  if (!body?.connections || !Array.isArray(body.connections)) {
    return err(400, "connections array is required")
  }

  const { connections, jobTitle = "", companyName = "" } = body
  const ranked = rankConnections(connections as ShadowConnection[])

  // Return top 20 (rest are low-signal)
  return NextResponse.json({ ranked: ranked.slice(0, 20), total: ranked.length })
}

/**
 * POST /api/apex/shadow-network/dm
 * Body: { connection: ScoredConnection, jobTitle, companyName }
 * Generates a personalized DM for a specific connection.
 */
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err(401, "Unauthorized")

  const body = await req.json().catch(() => null)
  if (!body?.connection) return err(400, "connection is required")

  // Get candidate profile for personalization. Read defensively via the
  // postgres pool (the server supabase client is auth-only in this codebase).
  let candidateName = "there"
  let candidateHeadline = "software engineer"
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM profiles WHERE id = $1 LIMIT 1`,
      [user.id],
    )
    const p = rows[0]
    candidateName     = (p?.full_name as string) || (p?.name as string) || "there"
    candidateHeadline = (p?.headline as string) || (p?.current_title as string) || "software engineer"
  } catch {
    // use defaults
  }

  try {
    const dm = await generateDM(
      body.connection,
      body.jobTitle    ?? "",
      body.companyName ?? "",
      candidateName,
      candidateHeadline,
    )
    return NextResponse.json({ dm })
  } catch (e) {
    console.error("[shadow-network] DM generation error:", e)
    return err(500, e instanceof Error ? e.message : "DM generation failed")
  }
}
