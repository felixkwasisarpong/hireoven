import { NextResponse } from "next/server"
import { generateVariants } from "@/lib/resume/cover-letter-generator"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import type { CoverLetterOptions, Company, Job, Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    jobId?: string
    options?: CoverLetterOptions
  }
  const { jobId, options } = body

  if (!jobId || !options) {
    return NextResponse.json({ error: "jobId and options are required" }, { status: 400 })
  }

  const { data: resumeData } = await supabase
    .from("resumes")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_primary", true)
    .eq("parse_status", "complete")
    .limit(1)
    .single()

  if (!resumeData) {
    return NextResponse.json({ error: "No parsed resume found" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: jobData } = await (admin
    .from("jobs")
    .select("*, company:companies(*)")
    .eq("id", jobId)
    .single() as any)

  if (!jobData) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  try {
    const variants = await generateVariants(
      resumeData as Resume,
      jobData as Job & { company: Company },
      options,
      user.id,
      3
    )
    return NextResponse.json(variants)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Variants generation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
