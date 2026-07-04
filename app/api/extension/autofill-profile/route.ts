/**
 * GET /api/extension/autofill-profile
 *
 * Returns a safe, stripped-down autofill profile for the Chrome extension.
 * Only fields that are safe to prefill in job application forms are returned.
 * Diversity fields (gender, ethnicity, disability, veteran) are excluded.
 *
 * Auth: Bearer <ho_session JWT> header sent by the Chrome extension.
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionError,
  extensionCorsHeaders,
  requireExtensionAuth,
  handleExtensionPreflight,
} from "@/lib/extension/auth"
import type { AutofillProfile } from "@/types"

export const runtime = "nodejs"

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

type SafeResumeExperience = {
  title: string | null
  company: string | null
  location: string | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
  achievements: string[]
}

type SafeResumeEducation = {
  institution: string | null
  degree: string | null
  field: string | null
  start_date: string | null
  end_date: string | null
  gpa: string | null
}

function cleanString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLen)
}

function cleanStringArray(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const trimmed = item.trim()
    if (!trimmed) continue
    out.push(trimmed.slice(0, maxLen))
    if (out.length >= maxItems) break
  }
  return out
}

/** Certifications live in the resume's skills bucket as a string[] of names. */
function cleanCertifications(skills: unknown, maxItems = 12, maxLen = 120): string[] {
  if (!skills || typeof skills !== "object") return []
  const certs = (skills as { certifications?: unknown }).certifications
  return cleanStringArray(certs, maxItems, maxLen)
}

function cleanWorkExperience(value: unknown, maxItems = 8): SafeResumeExperience[] {
  if (!Array.isArray(value)) return []
  const out: SafeResumeExperience[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    out.push({
      title: cleanString(row.title, 160),
      company: cleanString(row.company, 160),
      location: cleanString(row.location, 160),
      start_date: cleanString(row.start_date, 40),
      end_date: cleanString(row.end_date, 40),
      is_current: row.is_current === true,
      description: cleanString(row.description, 2400),
      achievements: cleanStringArray(row.achievements, 8, 360),
    })
    if (out.length >= maxItems) break
  }
  return out
}

function cleanEducation(value: unknown, maxItems = 6): SafeResumeEducation[] {
  if (!Array.isArray(value)) return []
  const out: SafeResumeEducation[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    out.push({
      institution: cleanString(row.institution, 180),
      degree: cleanString(row.degree, 140),
      field: cleanString(row.field, 140),
      start_date: cleanString(row.start_date, 40),
      end_date: cleanString(row.end_date, 40),
      gpa: cleanString(row.gpa, 32),
    })
    if (out.length >= maxItems) break
  }
  return out
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const pool = getPostgresPool()
  const result = await pool.query<AutofillProfile & {
    resume_full_name: string | null
    resume_current_title: string | null
    resume_current_company: string | null
    resume_email: string | null
    resume_phone: string | null
    resume_location: string | null
    resume_linkedin_url: string | null
    resume_portfolio_url: string | null
    resume_summary: string | null
    resume_top_skills: string[] | null
    resume_work_experience: unknown
    resume_education: unknown
    resume_skills: unknown
  }>(
    `SELECT ap.*,
            r.full_name     AS resume_full_name,
            r.primary_role   AS resume_current_title,
            r.work_experience->0->>'company' AS resume_current_company,
            r.email         AS resume_email,
            r.phone         AS resume_phone,
            r.location      AS resume_location,
            r.linkedin_url  AS resume_linkedin_url,
            r.portfolio_url AS resume_portfolio_url,
            r.summary        AS resume_summary,
            r.top_skills     AS resume_top_skills,
            r.work_experience AS resume_work_experience,
            r.education       AS resume_education,
            r.skills          AS resume_skills
     FROM autofill_profiles ap
     LEFT JOIN LATERAL (
       SELECT full_name, primary_role, email, phone, location, linkedin_url, portfolio_url, summary, top_skills, work_experience, education, skills
       FROM resumes
       WHERE user_id = $1
       ORDER BY is_primary DESC, updated_at DESC
       LIMIT 1
     ) r ON true
     WHERE ap.user_id = $1
     ORDER BY ap.updated_at DESC
     LIMIT 1`,
    [user.sub]
  ).catch((err) => {
    console.error("[extension/autofill-profile] profile fetch failed:", err)
    return null
  })

  if (!result) {
    return extensionError(request, 500, "Failed to fetch autofill profile")
  }

  const profile = result.rows[0] ?? null

  if (!profile) {
    return NextResponse.json(
      { profile: null, profileMissing: true },
      { status: 200, headers }
    )
  }

  const topSkills = cleanStringArray(profile.resume_top_skills, 24, 100)
  const workExperience = cleanWorkExperience(profile.resume_work_experience)
  const education = cleanEducation(profile.resume_education)
  const certifications = cleanCertifications(profile.resume_skills)

  // Return only safe fields for autofill.
  // Diversity fields (gender, ethnicity, veteran, disability) are included only
  // when the user has explicitly opted in via auto_fill_diversity.
  const safeProfile = {
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    phone: profile.phone,
    linkedin_url: profile.linkedin_url,
    github_url: profile.github_url,
    portfolio_url: profile.portfolio_url,
    website_url: profile.website_url,
    address_line1: profile.address_line1,
    address_line2: profile.address_line2,
    city: profile.city,
    state: profile.state,
    zip_code: profile.zip_code,
    country: profile.country ?? null,
    authorized_to_work: profile.authorized_to_work ?? null,
    requires_sponsorship: profile.requires_sponsorship ?? null,
    sponsorship_statement: profile.sponsorship_statement,
    work_authorization: profile.work_authorization,
    years_of_experience: profile.years_of_experience,
    salary_expectation_min: profile.salary_expectation_min,
    salary_expectation_max: profile.salary_expectation_max,
    earliest_start_date: profile.earliest_start_date,
    willing_to_relocate: profile.willing_to_relocate ?? null,
    preferred_work_type: profile.preferred_work_type,
    highest_degree: profile.highest_degree,
    field_of_study: profile.field_of_study,
    university: profile.university,
    graduation_year: profile.graduation_year,
    gpa: profile.gpa,
    // EEO fields — only sent when user has explicitly opted in
    auto_fill_diversity: profile.auto_fill_diversity ?? false,
    gender: profile.auto_fill_diversity ? (profile.gender ?? null) : null,
    ethnicity: profile.auto_fill_diversity ? (profile.ethnicity ?? null) : null,
    hispanic_latino: profile.auto_fill_diversity ? (profile.hispanic_latino ?? null) : null,
    veteran_status: profile.auto_fill_diversity ? (profile.veteran_status ?? null) : null,
    disability_status: profile.auto_fill_diversity ? (profile.disability_status ?? null) : null,
    // Resume-derived fields
    resume_full_name: profile.resume_full_name ?? null,
    current_title: profile.resume_current_title ?? null,
    current_company: profile.resume_current_company ?? null,
    resume_email: profile.resume_email ?? null,
    resume_phone: profile.resume_phone ?? null,
    resume_location: profile.resume_location ?? null,
    resume_linkedin_url: profile.resume_linkedin_url ?? null,
    resume_portfolio_url: profile.resume_portfolio_url ?? null,
    resume_summary: profile.resume_summary ?? null,
    skills: topSkills.length ? topSkills.join(", ") : null,
    top_skills: topSkills,
    work_experience: workExperience,
    resume_education: education,
    resume_certifications: certifications,
  }

  return NextResponse.json(
    { profile: safeProfile, profileMissing: false },
    { status: 200, headers }
  )
}
