import { NextResponse } from "next/server"
import { parseResumeFromText } from "@/lib/resume/parser"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { calculateAtsReadability } from "@/lib/resume/hub"
import { getUserPlan } from "@/lib/gates/server-gate"
import type { Profile, Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

const MIN_TEXT_LENGTH = 80

function mergeRoles(currentRoles: string[] | null, primaryRole: string | null) {
  if (!primaryRole) return currentRoles
  return Array.from(new Set([...(currentRoles ?? []), primaryRole]))
}

async function ensureResumeColumns(pool: ReturnType<typeof getPostgresPool>) {
  await pool.query(
    `ALTER TABLE resumes
       ADD COLUMN IF NOT EXISTS file_type TEXT,
       ADD COLUMN IF NOT EXISTS parse_error TEXT,
       ADD COLUMN IF NOT EXISTS github_url TEXT,
       ADD COLUMN IF NOT EXISTS certifications JSONB,
       ADD COLUMN IF NOT EXISTS additional_sections JSONB,
       ADD COLUMN IF NOT EXISTS ats_score INTEGER,
       ALTER COLUMN file_url DROP NOT NULL,
       ALTER COLUMN storage_path DROP NOT NULL`
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { userId } = await getUserPlan()
  if (!userId || userId !== user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let rawText = ""
  try {
    const body = (await request.json()) as { rawText?: unknown }
    rawText = typeof body.rawText === "string" ? body.rawText.trim() : ""
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (rawText.length < MIN_TEXT_LENGTH) {
    return NextResponse.json(
      { error: "That doesn't look like a complete LinkedIn profile. Copy your whole profile and try again." },
      { status: 400 }
    )
  }

  const pool = getPostgresPool()

  try {
    await ensureResumeColumns(pool)

    const parsed = await parseResumeFromText(rawText)

    const atsScore = calculateAtsReadability({
      ...parsed,
      parse_status: "complete",
      parse_error: null,
      file_name: "LinkedIn import",
      file_type: "linkedin",
      certifications: null,
    })

    const existing = await pool.query<{ has_primary: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM resumes WHERE user_id = $1 AND is_primary = true
       ) AS has_primary`,
      [user.id]
    )
    const shouldBePrimary = !existing.rows[0]?.has_primary
    if (shouldBePrimary) {
      await pool.query(`UPDATE resumes SET is_primary = false WHERE user_id = $1`, [user.id])
    }

    const resumeName = parsed.full_name ? `${parsed.full_name} — LinkedIn` : "LinkedIn import"

    const insertResult = await pool.query<Resume>(
      `INSERT INTO resumes (
        user_id, file_name, name, file_url, storage_path, file_size, file_type,
        is_primary, parse_status, parse_error, full_name, email, phone, location,
        linkedin_url, portfolio_url, github_url, summary, work_experience, education,
        skills, projects, certifications, seniority_level, years_of_experience,
        primary_role, industries, top_skills, resume_score, ats_score, raw_text,
        additional_sections
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19::jsonb, $20::jsonb,
        $21::jsonb, $22::jsonb, $23::jsonb, $24,
        $25, $26, $27::text[], $28::text[], $29, $30, $31,
        $32::jsonb
      )
      RETURNING *`,
      [
        user.id,
        "LinkedIn import",
        resumeName,
        null,
        null,
        null,
        "linkedin",
        shouldBePrimary,
        "complete",
        null,
        parsed.full_name,
        parsed.email,
        parsed.phone,
        parsed.location,
        parsed.linkedin_url,
        parsed.portfolio_url,
        null,
        parsed.summary,
        JSON.stringify(parsed.work_experience ?? null),
        JSON.stringify(parsed.education ?? null),
        JSON.stringify(parsed.skills ?? null),
        JSON.stringify(parsed.projects ?? null),
        JSON.stringify(null),
        parsed.seniority_level,
        parsed.years_of_experience,
        parsed.primary_role,
        parsed.industries ?? [],
        parsed.top_skills ?? [],
        parsed.resume_score,
        atsScore,
        parsed.raw_text,
        JSON.stringify(parsed.additional_sections ?? []),
      ]
    )

    const resume = insertResult.rows[0]
    if (!resume) {
      throw new Error("Failed to create resume record")
    }

    // Enrich the profile the same way the file upload does (best-effort).
    try {
      const profileResult = await pool.query<Pick<Profile, "desired_roles">>(
        `SELECT desired_roles FROM profiles WHERE id = $1 LIMIT 1`,
        [user.id]
      )
      const profile = profileResult.rows[0] ?? null
      await pool.query(
        `UPDATE profiles
            SET desired_roles = $1::text[], seniority_level = $2, top_skills = $3::text[], updated_at = now()
          WHERE id = $4`,
        [
          mergeRoles((profile as Pick<Profile, "desired_roles"> | null)?.desired_roles ?? null, parsed.primary_role) ?? [],
          parsed.seniority_level,
          parsed.top_skills ?? [],
          user.id,
        ]
      )
    } catch (profileError) {
      console.warn("Skipped profile enrichment after LinkedIn import", profileError)
    }

    return NextResponse.json({ id: resume.id, resumeId: resume.id, status: "complete", resume })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import LinkedIn profile"
    console.error("LinkedIn resume import failed", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
