import { NextResponse } from "next/server"
import { parseResume } from "@/lib/resume/parser"
import { createAdminClient } from "@/lib/supabase/admin"
import { uploadResume, deleteResume, getResumeUrl } from "@/lib/supabase/storage"
import { createClient } from "@/lib/supabase/server"
import { MAX_RESUME_SIZE_BYTES, isResumeFilename, isResumeMimeType } from "@/lib/resume/constants"
import type { Profile, Resume, ResumeInsert } from "@/types"

export const runtime = "nodejs"

function defaultResumeName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Resume"
}

function mergeRoles(currentRoles: string[] | null, primaryRole: string | null) {
  if (!primaryRole) return currentRoles
  return Array.from(new Set([...(currentRoles ?? []), primaryRole]))
}

async function processResumeInBackground({
  resumeId,
  userId,
  fileName,
  fileUrl,
  storagePath,
}: {
  resumeId: string
  userId: string
  fileName: string
  fileUrl: string
  storagePath: string
}) {
  const supabase = createAdminClient()

  try {
    const parsed = await parseResume(fileUrl, fileName)
    const refreshedUrl = await getResumeUrl(storagePath)

    await (supabase.from("resumes") as any)
      .update({
        file_url: refreshedUrl,
        parse_status: "complete",
        full_name: parsed.full_name,
        email: parsed.email,
        phone: parsed.phone,
        location: parsed.location,
        linkedin_url: parsed.linkedin_url,
        portfolio_url: parsed.portfolio_url,
        summary: parsed.summary,
        work_experience: parsed.work_experience,
        education: parsed.education,
        skills: parsed.skills,
        projects: parsed.projects,
        seniority_level: parsed.seniority_level,
        years_of_experience: parsed.years_of_experience,
        primary_role: parsed.primary_role,
        industries: parsed.industries,
        top_skills: parsed.top_skills,
        resume_score: parsed.resume_score,
        raw_text: parsed.raw_text,
      } satisfies Partial<Resume>)
      .eq("id", resumeId)
      .eq("user_id", userId)

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, desired_roles, seniority_level, top_skills")
      .eq("id", userId)
      .single()

    await (supabase.from("profiles") as any)
      .update({
        desired_roles: mergeRoles((profile as Pick<Profile, "desired_roles"> | null)?.desired_roles ?? null, parsed.primary_role),
        seniority_level: parsed.seniority_level,
        top_skills: parsed.top_skills,
      } satisfies Partial<Profile>)
      .eq("id", userId)
  } catch (error) {
    console.error("Resume parsing failed", error)
    await (supabase.from("resumes") as any)
      .update({ parse_status: "failed" } satisfies Partial<Resume>)
      .eq("id", resumeId)
      .eq("user_id", userId)
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get("file")

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A PDF or DOCX file is required" }, { status: 400 })
  }

  if ((!isResumeMimeType(file.type) && !isResumeFilename(file.name)) || file.size > MAX_RESUME_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Resume must be a PDF or DOCX file that is 5MB or smaller" },
      { status: 400 }
    )
  }

  const { data: existingResumes, error: existingError } = await ((supabase
    .from("resumes")
    .select("id, is_primary")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })) as any)

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  if ((existingResumes?.length ?? 0) >= 3) {
    return NextResponse.json(
      { error: "You can upload up to 3 resumes" },
      { status: 400 }
    )
  }

  let uploadedPath = ""

  try {
    const { url, path } = await uploadResume(user.id, file)
    uploadedPath = path
    const shouldBePrimary = !(
      (existingResumes as Array<{ id: string; is_primary: boolean }> | null) ?? []
    ).some((resume) => resume.is_primary)

    if (shouldBePrimary) {
      await (supabase.from("resumes") as any)
        .update({ is_primary: false } satisfies Partial<Resume>)
        .eq("user_id", user.id)
    }

    const payload: ResumeInsert = {
      user_id: user.id,
      file_name: file.name,
      name: defaultResumeName(file.name),
      file_url: url,
      storage_path: path,
      file_size: file.size,
      is_primary: shouldBePrimary,
      parse_status: "processing",
      full_name: null,
      email: null,
      phone: null,
      location: null,
      linkedin_url: null,
      portfolio_url: null,
      summary: null,
      work_experience: null,
      education: null,
      skills: null,
      projects: null,
      seniority_level: null,
      years_of_experience: null,
      primary_role: null,
      industries: null,
      top_skills: null,
      resume_score: null,
      raw_text: null,
    }

    const { data: resume, error: insertError } = await (supabase
      .from("resumes")
      .insert(payload as any)
      .select("*")
      .single() as any)

    if (insertError || !resume) {
      throw insertError ?? new Error("Failed to create resume record")
    }

    queueMicrotask(() => {
      void processResumeInBackground({
        resumeId: resume.id,
        userId: user.id,
        fileName: file.name,
        fileUrl: url,
        storagePath: path,
      })
    })

    return NextResponse.json({
      resumeId: resume.id,
      status: "processing",
    })
  } catch (error) {
    if (uploadedPath) {
      try {
        await deleteResume(uploadedPath)
      } catch (cleanupError) {
        console.error("Failed to clean up uploaded resume after API error", cleanupError)
      }
    }

    const message = error instanceof Error ? error.message : "Failed to upload resume"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
