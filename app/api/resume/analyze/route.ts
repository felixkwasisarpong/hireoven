import { NextResponse } from "next/server"
import { analyzeResumeForJob, getCachedAnalysis } from "@/lib/resume/analyzer"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import type { Company, Job, Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const resumeId = searchParams.get("resumeId")
  const jobId = searchParams.get("jobId")

  if (!resumeId || !jobId) {
    return NextResponse.json({ error: "resumeId and jobId are required" }, { status: 400 })
  }

  const analysis = await getCachedAnalysis(user.id, resumeId, jobId)
  if (!analysis) return NextResponse.json(null)
  return NextResponse.json(analysis)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { resumeId?: string; jobId?: string }
  const { resumeId, jobId } = body

  if (!resumeId || !jobId) {
    return NextResponse.json({ error: "resumeId and jobId are required" }, { status: 400 })
  }

  // Verify resume ownership
  const { data: resumeData } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .single()

  if (!resumeData) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const resume = resumeData as Resume

  if (resume.parse_status !== "complete") {
    return NextResponse.json(
      { error: "Resume must finish parsing before analysis" },
      { status: 400 }
    )
  }

  // Check cache first
  const cached = await getCachedAnalysis(user.id, resumeId, jobId)
  if (cached) return NextResponse.json(cached)

  // Fetch job + company
  const admin = createAdminClient()
  const { data: jobData } = await (admin
    .from("jobs")
    .select("*, company:companies(*)")
    .eq("id", jobId)
    .single() as any)

  if (!jobData) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const job = jobData as Job & { company: Company }

  try {
    const analysis = await analyzeResumeForJob(resume, job, user.id)
    return NextResponse.json(analysis)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
