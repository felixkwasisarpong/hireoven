import { NextResponse } from "next/server"
import { generateCoverLetter } from "@/lib/resume/cover-letter-generator"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import type { CoverLetter, CoverLetterOptions, Company, Job, Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 120

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  const { data } = await supabase
    .from("cover_letters" as any)
    .select("*")
    .eq("user_id", user.id)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  return NextResponse.json((data as CoverLetter | null) ?? null)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    resumeId?: string
    jobId?: string
    options?: CoverLetterOptions
  }
  const { resumeId, jobId, options } = body

  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })
  if (!options) return NextResponse.json({ error: "options are required" }, { status: 400 })

  // Resolve resume: use provided ID or fall back to primary
  let resume: Resume | null = null
  if (resumeId) {
    const { data } = await supabase
      .from("resumes")
      .select("*")
      .eq("id", resumeId)
      .eq("user_id", user.id)
      .single()
    resume = (data as Resume | null)
  } else {
    const { data } = await supabase
      .from("resumes")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_primary", true)
      .eq("parse_status", "complete")
      .limit(1)
      .single()
    resume = (data as Resume | null)
  }

  if (!resume) {
    return NextResponse.json(
      { error: "No parsed resume found. Upload and parse a resume first." },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const { data: jobData } = await (admin
    .from("jobs")
    .select("*, company:companies(*)")
    .eq("id", jobId)
    .single() as any)

  if (!jobData) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const job = jobData as Job & { company: Company }

  try {
    const coverLetter = await generateCoverLetter(resume, job, options, user.id)
    return NextResponse.json(coverLetter)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
