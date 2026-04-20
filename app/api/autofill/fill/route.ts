import { NextResponse } from "next/server"
import { generateFillScript } from "@/lib/autofill"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireFeature } from "@/lib/gates/server-gate"
import type { AutofillProfile } from "@/types"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const gate = await requireFeature("autofill")
  if (gate instanceof NextResponse) return gate

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user!

  const body = await request.json().catch(() => ({})) as { jobId?: string }
  const { jobId } = body

  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  // Fetch autofill profile
  const { data: profileData } = await (supabase
    .from("autofill_profiles" as any)
    .select("*")
    .eq("user_id", user.id)
    .single() as any)

  if (!profileData) {
    return NextResponse.json(
      { error: "No autofill profile found. Set one up first." },
      { status: 400 }
    )
  }

  const profile = profileData as AutofillProfile

  // Fetch job to get ATS type
  const admin = createAdminClient()
  const { data: jobData, error: jobError } = await (admin
    .from("jobs")
    .select("id, title, apply_url, company:companies(name, ats_type)")
    .eq("id", jobId)
    .single() as any)

  if (jobError || !jobData) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const job = jobData as { id: string; title: string; apply_url: string | null; company?: { name: string; ats_type: string | null } | null }
  const atsType = job?.company?.ats_type ?? "generic"
  const applyUrl = job?.apply_url ?? ""

  const { script, estimatedFields } = generateFillScript(profile, atsType)

  return NextResponse.json({
    script,
    atsType,
    estimatedFields,
    applyUrl,
    jobTitle: job?.title ?? "",
    companyName: job?.company?.name ?? "",
  })
}
