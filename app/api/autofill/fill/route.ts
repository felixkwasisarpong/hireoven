import { NextResponse } from "next/server"
import { generateFillScript } from "@/lib/autofill"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { requireFeature } from "@/lib/gates/server-gate"
import type { AutofillProfile } from "@/types"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const gate = await requireFeature("autofill")
  if (gate instanceof NextResponse) return gate

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user!
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as { jobId?: string }
  const { jobId } = body

  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  // Fetch autofill profile
  const profileResult = await pool.query<AutofillProfile>(
    `SELECT *
     FROM autofill_profiles
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [user.id]
  )
  const profileData = profileResult.rows[0]

  if (!profileData) {
    return NextResponse.json(
      { error: "No autofill profile found. Set one up first." },
      { status: 400 }
    )
  }

  const profile = profileData as AutofillProfile

  // Fetch job to get ATS type
  const jobResult = await pool.query<{
    id: string
    title: string
    apply_url: string | null
    company_name: string | null
    company_ats_type: string | null
  }>(
    `SELECT jobs.id, jobs.title, jobs.apply_url, companies.name AS company_name, companies.ats_type AS company_ats_type
     FROM jobs
     LEFT JOIN companies ON companies.id = jobs.company_id
     WHERE jobs.id = $1
     LIMIT 1`,
    [jobId]
  )
  const jobData = jobResult.rows[0]

  if (!jobData) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const atsType = jobData.company_ats_type ?? "generic"
  const applyUrl = jobData.apply_url ?? ""

  const { script, estimatedFields } = generateFillScript(profile, atsType)

  return NextResponse.json({
    script,
    atsType,
    estimatedFields,
    applyUrl,
    jobTitle: jobData.title ?? "",
    companyName: jobData.company_name ?? "",
  })
}
