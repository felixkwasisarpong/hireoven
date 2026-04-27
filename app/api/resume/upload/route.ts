import { NextResponse } from "next/server"
import { parseResume } from "@/lib/resume/parser"
import { getPostgresPool } from "@/lib/postgres/server"
import { uploadResume, deleteResume, getResumeUrl } from "@/lib/supabase/storage"
import { createClient } from "@/lib/supabase/server"
import { MAX_RESUME_SIZE_BYTES, isResumeFilename, isResumeMimeType } from "@/lib/resume/constants"
import { calculateAtsReadability } from "@/lib/resume/hub"
import { getUserPlan } from "@/lib/gates/server-gate"
import type { Profile, Resume, ResumeInsert } from "@/types"

export const runtime = "nodejs"

function defaultResumeName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Resume"
}

function mergeRoles(currentRoles: string[] | null, primaryRole: string | null) {
  if (!primaryRole) return currentRoles
  return Array.from(new Set([...(currentRoles ?? []), primaryRole]))
}

async function ensureResumeUploadColumns(pool: ReturnType<typeof getPostgresPool>) {
  await pool.query(
    `ALTER TABLE resumes
       ADD COLUMN IF NOT EXISTS file_type TEXT,
       ADD COLUMN IF NOT EXISTS parse_error TEXT,
       ADD COLUMN IF NOT EXISTS github_url TEXT,
       ADD COLUMN IF NOT EXISTS certifications JSONB,
       ADD COLUMN IF NOT EXISTS ats_score INTEGER`
  )
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
  const pool = getPostgresPool()

  try {
    const parsed = await parseResume(fileUrl, fileName)
    const refreshedUrl = await getResumeUrl(storagePath)
    const atsScore = calculateAtsReadability({
      ...parsed,
      parse_status: "complete",
      parse_error: null,
      file_name: fileName,
      file_type: fileName.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : fileName.toLowerCase().endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : null,
      certifications: null,
    })

    await pool.query(
      `UPDATE resumes
       SET
         file_url = $1,
         parse_status = $2,
         parse_error = NULL,
         full_name = $3,
         email = $4,
         phone = $5,
         location = $6,
         linkedin_url = $7,
         portfolio_url = $8,
         summary = $9,
         work_experience = $10::jsonb,
         education = $11::jsonb,
         skills = $12::jsonb,
         projects = $13::jsonb,
         seniority_level = $14,
         years_of_experience = $15,
         primary_role = $16,
         industries = $17::text[],
         top_skills = $18::text[],
         resume_score = $19,
         ats_score = $20,
         raw_text = $21,
         updated_at = now()
       WHERE id = $22
         AND user_id = $23`,
      [
        refreshedUrl,
        "complete",
        parsed.full_name,
        parsed.email,
        parsed.phone,
        parsed.location,
        parsed.linkedin_url,
        parsed.portfolio_url,
        parsed.summary,
        JSON.stringify(parsed.work_experience ?? null),
        JSON.stringify(parsed.education ?? null),
        JSON.stringify(parsed.skills ?? null),
        JSON.stringify(parsed.projects ?? null),
        parsed.seniority_level,
        parsed.years_of_experience,
        parsed.primary_role,
        parsed.industries ?? [],
        parsed.top_skills ?? [],
        parsed.resume_score,
        atsScore,
        parsed.raw_text,
        resumeId,
        userId,
      ]
    )

    try {
      const profileResult = await pool.query<Pick<Profile, "desired_roles">>(
        `SELECT desired_roles
         FROM profiles
         WHERE id = $1
         LIMIT 1`,
        [userId]
      )
      const profile = profileResult.rows[0] ?? null

      await pool.query(
        `UPDATE profiles
         SET
           desired_roles = $1::text[],
           seniority_level = $2,
           top_skills = $3::text[],
           updated_at = now()
         WHERE id = $4`,
        [
          mergeRoles((profile as Pick<Profile, "desired_roles"> | null)?.desired_roles ?? null, parsed.primary_role) ?? [],
          parsed.seniority_level,
          parsed.top_skills ?? [],
          userId,
        ]
      )
    } catch (profileError) {
      // Some local/restored datasets may not include every profile enrichment column.
      // Parsing should still succeed and keep the uploaded resume usable.
      console.warn("Skipped profile enrichment after resume parse", profileError)
    }
  } catch (error) {
    console.error("Resume parsing failed", error)
    await pool.query(
      `UPDATE resumes
       SET parse_status = $1, parse_error = $2, updated_at = now()
       WHERE id = $3
         AND user_id = $4`,
      ["failed", error instanceof Error ? error.message : "Resume parsing failed", resumeId, userId]
    )
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
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

  const { userId, plan } = await getUserPlan()
  if (!userId || userId !== user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pool = getPostgresPool()
  await ensureResumeUploadColumns(pool)

  const existingResumesResult = await pool.query<Array<{ id: string; is_primary: boolean }>[number]>(
    `SELECT id, is_primary
     FROM resumes
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [user.id]
  )
  const existingResumes = existingResumesResult.rows

  const existingCount = existingResumes?.length ?? 0
  const maxResumes = 3

  if (existingCount >= maxResumes) {
    return NextResponse.json(
      {
        error: "You can upload up to 3 resumes",
        requiredPlan: null,
      },
      { status: 403 }
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
      await pool.query(
        `UPDATE resumes
         SET is_primary = false
         WHERE user_id = $1`,
        [user.id]
      )
    }

    const payload: ResumeInsert = {
      user_id: user.id,
      file_name: file.name,
      name: defaultResumeName(file.name),
      file_url: url,
      storage_path: path,
      file_size: file.size,
      file_type: file.type || null,
      is_primary: shouldBePrimary,
      parse_status: "processing",
      parse_error: null,
      full_name: null,
      email: null,
      phone: null,
      location: null,
      linkedin_url: null,
      portfolio_url: null,
      github_url: null,
      summary: null,
      work_experience: null,
      education: null,
      skills: null,
      projects: null,
      certifications: null,
      seniority_level: null,
      years_of_experience: null,
      primary_role: null,
      industries: null,
      top_skills: null,
      resume_score: null,
      ats_score: null,
      raw_text: null,
    }

    const insertResult = await pool.query<Resume>(
      `INSERT INTO resumes (
        user_id,
        file_name,
        name,
        file_url,
        storage_path,
        file_size,
        file_type,
        is_primary,
        parse_status,
        parse_error,
        full_name,
        email,
        phone,
        location,
        linkedin_url,
        portfolio_url,
        github_url,
        summary,
        work_experience,
        education,
        skills,
        projects,
        certifications,
        seniority_level,
        years_of_experience,
        primary_role,
        industries,
        top_skills,
        resume_score,
        ats_score,
        raw_text
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19::jsonb, $20::jsonb, $21::jsonb,
        $22::jsonb, $23::jsonb,
        $24, $25, $26, $27::text[], $28::text[], $29, $30, $31
      )
      RETURNING *`,
      [
        payload.user_id,
        payload.file_name,
        payload.name,
        payload.file_url,
        payload.storage_path,
        payload.file_size,
        payload.file_type ?? null,
        payload.is_primary,
        payload.parse_status,
        payload.parse_error ?? null,
        payload.full_name,
        payload.email,
        payload.phone,
        payload.location,
        payload.linkedin_url,
        payload.portfolio_url,
        payload.github_url ?? null,
        payload.summary,
        JSON.stringify(payload.work_experience ?? null),
        JSON.stringify(payload.education ?? null),
        JSON.stringify(payload.skills ?? null),
        JSON.stringify(payload.projects ?? null),
        JSON.stringify(payload.certifications ?? null),
        payload.seniority_level,
        payload.years_of_experience,
        payload.primary_role,
        payload.industries ?? [],
        payload.top_skills ?? [],
        payload.resume_score,
        payload.ats_score ?? null,
        payload.raw_text,
      ]
    )
    const resume = insertResult.rows[0]
    if (!resume) {
      throw new Error("Failed to create resume record")
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
      resume,
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
