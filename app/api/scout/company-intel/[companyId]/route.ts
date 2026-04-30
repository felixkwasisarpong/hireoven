/**
 * GET /api/scout/company-intel/[companyId]
 *
 * Returns CompanyIntel derived from existing DB data — no new schema, no AI calls.
 * Fast enough to call on company context change in Scout workspace.
 *
 * Cache: 6-hour stale-while-revalidate (data changes slowly).
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { deriveCompanyIntel, buildCompanyIntelSummary } from "@/lib/scout/company-intel/aggregator"
import type { Company, Job } from "@/types"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  const [companyRes, jobsRes] = await Promise.all([
    pool.query<Company>(
      `SELECT * FROM companies WHERE id = $1 LIMIT 1`,
      [companyId]
    ),
    pool.query<Job>(
      `SELECT id, title, first_detected_at, last_seen_at, is_active, is_remote,
              sponsors_h1b, sponsorship_score, skills, normalized_title
       FROM jobs
       WHERE company_id = $1 AND is_active = true
       ORDER BY first_detected_at DESC
       LIMIT 100`,
      [companyId]
    ),
  ])

  const company = companyRes.rows[0]
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })

  const jobs  = jobsRes.rows
  const intel = deriveCompanyIntel(company, jobs)
  const summary = buildCompanyIntelSummary(company, intel, jobs.length)
  console.log("[company-intel]", { companyId, trend: intel.hiringVelocity?.trend, sponsorship: intel.sponsorshipSignals?.h1bHistory })

  return NextResponse.json(
    { intel, summary, companyName: company.name },
    {
      headers: {
        "Cache-Control": "s-maxage=21600, stale-while-revalidate=86400",
      },
    }
  )
}
