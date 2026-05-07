import { NextResponse } from "next/server"
import { generateFillScript } from "@/lib/autofill"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { bumpUsage } from "@/lib/usage/quotas-server"
import type { AutofillProfile } from "@/types"

export const runtime = "nodejs"

export async function POST(request: Request) {
  // Autofill is now quota-gated (free=10/mo, pro=50/mo, pro_max=unlimited)
  // rather than plan-gated, so any authenticated user can use it.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { plan } = await getUserPlan()
  const quota = await bumpUsage(user.id, "autofill", plan)
  if (quota.exceeded) {
    return NextResponse.json(
      { error: `Autofill limit reached (${quota.limit}/month). Upgrade to use more.`, code: "QUOTA_EXCEEDED" },
      { status: 429 }
    )
  }
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
