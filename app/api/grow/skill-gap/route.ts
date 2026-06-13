/**
 * GET /api/grow/skill-gap
 *
 * The skill-gap → learning engine. Pulls the user's current skills (primary
 * resume) and their target roles (profile.desired_roles), scopes to the live
 * postings for those roles, and returns the highest-leverage skills to learn —
 * each with how many roles it unlocks, the pay signal, and a course.
 *
 * All math lives in lib/grow/skill-gap.ts; this file is SQL + auth.
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { computeSkillGaps, type SkillGapJob } from "@/lib/grow/skill-gap"

export const runtime = "nodejs"

type ProfileRow = { desired_roles: string[] | null; needs_sponsorship: boolean | null }
type ResumeRow = {
  top_skills: string[] | null
  skills: { technical?: string[]; soft?: string[]; certifications?: string[] } | null
}
type JobRow = { id: string; skills: string[] | null; salary: number | null }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  const [profileRes, resumeRes] = await Promise.all([
    pool.query<ProfileRow>(
      `SELECT desired_roles, needs_sponsorship FROM profiles WHERE id = $1 LIMIT 1`,
      [user.id],
    ),
    pool.query<ResumeRow>(
      `SELECT top_skills, skills FROM resumes
        WHERE user_id = $1 AND parse_status = 'complete'
        ORDER BY is_primary DESC, updated_at DESC LIMIT 1`,
      [user.id],
    ),
  ])

  const profile = profileRes.rows[0]
  const resume = resumeRes.rows[0]

  const userSkills = [
    ...(resume?.top_skills ?? []),
    ...(resume?.skills?.technical ?? []),
    ...(resume?.skills?.certifications ?? []),
  ].filter(Boolean)

  const desiredRoles = (profile?.desired_roles ?? []).map((r) => r.trim()).filter(Boolean)

  // Can't map a gap without knowing the target or the starting point.
  if (desiredRoles.length === 0 || userSkills.length === 0) {
    return NextResponse.json({
      gaps: [],
      targetJobs: 0,
      eligibleNow: 0,
      haveSkills: userSkills.length,
      targetRoles: desiredRoles,
      needsProfile: desiredRoles.length === 0,
      needsResume: userSkills.length === 0,
    })
  }

  const titlePatterns = desiredRoles.map((r) => `%${r}%`)
  const needsSponsorship = profile?.needs_sponsorship === true

  // Live postings for the target roles. Sponsorship-only when the user needs it,
  // so "eligible roles" stays honest for visa seekers.
  const jobsRes = await pool.query<JobRow>(
    `SELECT j.id, j.skills,
            CASE
              WHEN j.salary_min IS NOT NULL AND j.salary_max IS NOT NULL THEN (j.salary_min + j.salary_max) / 2
              WHEN j.salary_max IS NOT NULL THEN j.salary_max
              ELSE j.salary_min
            END AS salary
       FROM jobs j
      WHERE j.is_active = true
        AND ${sqlPublishedJob("j")}
        AND j.skills IS NOT NULL AND array_length(j.skills, 1) > 0
        AND (j.title ILIKE ANY($1::text[]) OR j.normalized_title ILIKE ANY($1::text[]))
        AND ($2::boolean = false OR j.sponsors_h1b = true)
      ORDER BY j.first_detected_at DESC
      LIMIT 1500`,
    [titlePatterns, needsSponsorship],
  ).catch(() => ({ rows: [] as JobRow[] }))

  const jobs: SkillGapJob[] = jobsRes.rows.map((r) => ({
    jobId: r.id,
    requiredSkills: r.skills ?? [],
    salary: r.salary != null ? Number(r.salary) : null,
  }))

  const result = computeSkillGaps(jobs, userSkills)

  return NextResponse.json({
    ...result,
    targetRoles: desiredRoles,
    needsProfile: false,
    needsResume: false,
  })
}
