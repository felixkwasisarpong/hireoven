import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { rankConnections, type ScoredConnection, type ShadowConnection } from "@/lib/apex/shadow-network/scorer"
import { generateDM } from "@/lib/apex/shadow-network/outreach"
import { normalizeCompanyKey } from "@/lib/networking/job-contact-finder"

function err(status: number, msg: string) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * Persist the user's scraped connections for a company so they can later surface
 * in the job-page Networking Finder. A scan returns the full current set for one
 * company, so we replace that (user, company_norm) slice atomically.
 */
async function persistConnections(
  userId: string,
  companyName: string,
  ranked: ScoredConnection[],
): Promise<void> {
  const companyKey = normalizeCompanyKey(companyName)
  if (!companyKey) return

  const rows = ranked
    .filter((c) => c.name?.trim())
    .slice(0, 200)
    .map((c) => ({
      name: c.name.trim(),
      title: c.title?.trim() || null,
      company: c.company?.trim() || companyName,
      degree: Math.min(3, Math.max(1, c.degree)),
      profileUrl: c.profileUrl?.trim() || null,
      mutualCount: Number.isFinite(c.mutualCount) ? c.mutualCount : 0,
      recentlyActive: Boolean(c.recentlyActive),
      tenureMonths: Number.isFinite(c.tenureMonths) ? c.tenureMonths : 0,
      referralScore: Math.round(c.referralScore),
      referralTier: c.referralTier,
    }))

  const pool = getPostgresPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `DELETE FROM public.linkedin_connections WHERE user_id = $1::uuid AND company_norm = $2`,
      [userId, companyKey],
    )

    if (rows.length > 0) {
      const values: unknown[] = [userId, companyKey]
      const tuples = rows.map((r, i) => {
        const b = i * 10 + 3 // $1,$2 are user_id + company_norm
        values.push(
          r.name, r.title, r.company, r.degree, r.profileUrl,
          r.mutualCount, r.recentlyActive, r.tenureMonths, r.referralScore, r.referralTier,
        )
        return `($1::uuid, $${b}, $${b + 1}, $${b + 2}, $2, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`
      })
      await client.query(
        `INSERT INTO public.linkedin_connections
           (user_id, name, title, company, company_norm, degree, profile_url,
            mutual_count, recently_active, tenure_months, referral_score, referral_tier)
         VALUES ${tuples.join(", ")}`,
        values,
      )
    }

    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    throw e
  } finally {
    client.release()
  }
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

  // Persist for the job-page Networking Finder. Best-effort: a storage failure
  // must not break the live Shadow Network results.
  if (companyName.trim()) {
    try {
      await persistConnections(user.id, companyName, ranked)
    } catch (e) {
      console.error("[shadow-network] failed to persist connections:", e)
    }
  }

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
