import { NextResponse } from "next/server"
import { improveSummary, rewriteBulletPoint } from "@/lib/resume/editor"
import { createClient } from "@/lib/supabase/server"
import type { Job, Resume, ResumeEditContext, ResumeEditInsert, ResumeEditType, ResumeSection } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

type EditRequestBody = {
  resumeId?: string
  section?: ResumeSection
  originalContent?: string
  editType?: ResumeEditType
  jobId?: string
  missingKeywords?: string[]
  context?: ResumeEditContext | null
}

async function getAuthedResume(resumeId: string, userId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .single()

  return (data as Resume | null) ?? null
}

async function getJob(jobId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single()

  return (data as Job | null) ?? null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as EditRequestBody

  if (!body.resumeId || !body.section || !body.editType || typeof body.originalContent !== "string") {
    return NextResponse.json(
      { error: "resumeId, section, editType, and originalContent are required" },
      { status: 400 }
    )
  }

  const originalContent = body.originalContent

  const resume = await getAuthedResume(body.resumeId, user.id)
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const job = body.jobId ? await getJob(body.jobId) : null

  let suggestion = originalContent
  let keywordsAdded: string[] = []

  try {
    if (body.section === "summary") {
      suggestion = await improveSummary(originalContent || resume.summary, resume, job ?? undefined)
      keywordsAdded = (body.missingKeywords ?? []).filter((keyword) =>
        suggestion.toLowerCase().includes(keyword.toLowerCase()) &&
        !originalContent.toLowerCase().includes(keyword.toLowerCase())
      )
    } else if (body.section === "work_experience") {
      const experience = typeof body.context?.experienceIndex === "number"
        ? resume.work_experience?.[body.context.experienceIndex]
        : null

      const result = await rewriteBulletPoint(originalContent, {
        jobTitle: experience?.title ?? resume.primary_role ?? "Previous role",
        company: experience?.company ?? resume.full_name ?? "Candidate",
        missingKeywords: body.missingKeywords ?? [],
        targetJob: job
          ? {
              title: job.title,
              description: job.description ?? "",
            }
          : undefined,
        editType: body.editType,
      })

      suggestion = result.suggestion
      keywordsAdded = result.keywordsAdded
    } else {
      return NextResponse.json(
        { error: "This section is not supported by the AI editor yet" },
        { status: 400 }
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate suggestion"
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const payload: ResumeEditInsert = {
    user_id: user.id,
    resume_id: resume.id,
    job_id: body.jobId ?? null,
    section: body.section,
    original_content: originalContent,
    suggested_content: suggestion,
    edit_type: body.editType,
    keywords_added: keywordsAdded,
    was_accepted: null,
    feedback: null,
    context: body.context ?? null,
  }

  const { data, error } = await (((supabase.from("resume_edits") as any)
    .insert(payload as any)
    .select("*")
    .single()) as any)

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save suggestion" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    suggestion,
    keywordsAdded,
    editId: data.id,
    edit: data,
  })
}
