import { NextResponse } from "next/server"
import { applyResumeEditContent } from "@/lib/resume/state"
import { getResumeUrl } from "@/lib/supabase/storage"
import { createClient } from "@/lib/supabase/server"
import type { Resume, ResumeEdit, ResumeEditContext, ResumeSection } from "@/types"

export const runtime = "nodejs"

type AcceptBody = {
  editId?: string
  section?: ResumeSection
  content?: unknown
  context?: ResumeEditContext | null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as AcceptBody
  if (!body.editId || !body.section) {
    return NextResponse.json({ error: "editId and section are required" }, { status: 400 })
  }

  const { data: editData, error: editError } = await (supabase
    .from("resume_edits")
    .select("*")
    .eq("id", body.editId)
    .eq("user_id", user.id)
    .single() as any)

  if (editError || !editData) {
    return NextResponse.json({ error: "Edit not found" }, { status: 404 })
  }

  const edit = editData as ResumeEdit
  const { data: resumeData, error: resumeError } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", edit.resume_id)
    .eq("user_id", user.id)
    .single()

  if (resumeError || !resumeData) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const resume = resumeData as Resume
  const nextResume = applyResumeEditContent(
    resume,
    body.section,
    body.content ?? edit.suggested_content,
    body.context ?? edit.context
  )

  const updates = {
    summary: nextResume.summary,
    work_experience: nextResume.work_experience,
    education: nextResume.education,
    skills: nextResume.skills,
    projects: nextResume.projects,
    years_of_experience: nextResume.years_of_experience,
    primary_role: nextResume.primary_role,
    top_skills: nextResume.top_skills,
    resume_score: nextResume.resume_score,
    raw_text: nextResume.raw_text,
  }

  const [{ data: updatedResume, error: updateError }, { error: markError }] = await Promise.all([
    (((supabase.from("resumes") as any)
      .update(updates as any)
      .eq("id", resume.id)
      .eq("user_id", user.id)
      .select("*")
      .single()) as any),
    (((supabase.from("resume_edits") as any)
      .update({
        was_accepted: true,
      })
      .eq("id", edit.id)
      .eq("user_id", user.id)) as any),
  ])

  if (updateError || !updatedResume) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to update resume" },
      { status: 500 }
    )
  }

  if (markError) {
    console.error("Failed to mark resume edit accepted", markError)
  }

  try {
    const signedUrl = await getResumeUrl(updatedResume.storage_path)
    return NextResponse.json({
      ...updatedResume,
      file_url: signedUrl,
      download_url: signedUrl,
    })
  } catch {
    return NextResponse.json(updatedResume)
  }
}
