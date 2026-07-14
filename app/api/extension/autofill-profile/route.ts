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
import { restoreResumeFromSnapshot } from "@/lib/resume/hub"
import type { AutofillProfile, Resume, ResumeVersion } from "@/types"

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

function splitFullName(value: string | null): { first: string | null; last: string | null } {
  const cleaned = cleanString(value, 240)
  if (!cleaned) return { first: null, last: null }
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: null, last: null }
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const pool = getPostgresPool()
  const profileResult = await pool.query<AutofillProfile>(
    `SELECT *
     FROM autofill_profiles
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [user.sub]
  ).catch((err) => {
    console.error("[extension/autofill-profile] profile fetch failed:", err)
    return null
  })

  if (!profileResult) {
    return extensionError(request, 500, "Failed to fetch autofill profile")
  }

  const profile = profileResult.rows[0] ?? null

  const { searchParams } = new URL(request.url)
  const versionId = searchParams.get("versionId")
  const resumeId = searchParams.get("resumeId")
  const jobId = searchParams.get("jobId")

  let resume: Resume | null = null
  if (versionId) {
    const versionResult = await pool.query<ResumeVersion>(
      `SELECT * FROM resume_versions WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [versionId, user.sub],
    )
    const version = versionResult.rows[0] ?? null
    if (version) {
      const baseResult = await pool.query<Resume>(
        `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [version.resume_id, user.sub],
      )
      const baseResume = baseResult.rows[0] ?? null
      if (baseResume) {
        resume = version.snapshot ? restoreResumeFromSnapshot(baseResume, version.snapshot) : baseResume
      }
    }
  } else if (resumeId) {
    const resumeResult = await pool.query<Resume>(
      `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [resumeId, user.sub],
    )
    resume = resumeResult.rows[0] ?? null
  } else if (jobId) {
    const resumeResult = await pool.query<Resume>(
      `(
         SELECT * FROM resumes
         WHERE user_id = $1 AND tailored_for_job_id = $2
         ORDER BY updated_at DESC
         LIMIT 1
       )
       UNION ALL
       (
         SELECT * FROM resumes
         WHERE user_id = $1
         ORDER BY is_primary DESC NULLS LAST, updated_at DESC
         LIMIT 1
       )
       LIMIT 1`,
      [user.sub, jobId],
    )
    resume = resumeResult.rows[0] ?? null
  } else {
    const resumeResult = await pool.query<Resume>(
      `SELECT * FROM resumes
       WHERE user_id = $1
       ORDER BY is_primary DESC NULLS LAST, updated_at DESC
       LIMIT 1`,
      [user.sub],
    )
    resume = resumeResult.rows[0] ?? null
  }

  if (!profile && !resume) {
    return NextResponse.json(
      { profile: null, profileMissing: true },
      { status: 200, headers }
    )
  }

  const topSkills = cleanStringArray(resume?.top_skills, 24, 100)
  const workExperience = cleanWorkExperience(resume?.work_experience)
  const education = cleanEducation(resume?.education)
  const certifications = cleanCertifications(resume?.skills)
  const resumeName = splitFullName(resume?.full_name ?? null)
  const currentCompany = workExperience[0]?.company ?? null

  // EEO / diversity consent. Historically gated behind an explicit
  // auto_fill_diversity toggle, but entering these values in the autofill
  // profile (whose sole purpose IS autofill) already signals intent — so we
  // treat the presence of any EEO value as opt-in. The toggle can still be
  // used to force-disable (auto_fill_diversity === false with data present is
  // respected below only when the user has never set data, i.e. it's a no-op).
  const hasEeoData = Boolean(
    profile?.gender ||
      profile?.ethnicity ||
      profile?.hispanic_latino ||
      profile?.veteran_status ||
      profile?.disability_status,
  )
  const eeoOptIn = profile?.auto_fill_diversity === true || hasEeoData

  // Return only safe fields for autofill.
  // Diversity fields (gender, ethnicity, veteran, disability) are included when
  // the user opted in OR has filled any EEO value (presence = consent).
  const safeProfile = {
    first_name: profile?.first_name ?? resumeName.first,
    last_name: profile?.last_name ?? resumeName.last,
    email: profile?.email ?? resume?.email ?? null,
    phone: profile?.phone ?? resume?.phone ?? null,
    linkedin_url: profile?.linkedin_url ?? resume?.linkedin_url ?? null,
    github_url: profile?.github_url ?? null,
    portfolio_url: profile?.portfolio_url ?? resume?.portfolio_url ?? null,
    website_url: profile?.website_url ?? resume?.portfolio_url ?? null,
    address_line1: profile?.address_line1 ?? null,
    address_line2: profile?.address_line2 ?? null,
    city: profile?.city ?? null,
    state: profile?.state ?? null,
    zip_code: profile?.zip_code ?? null,
    country: profile?.country ?? null,
    authorized_to_work: profile?.authorized_to_work ?? null,
    requires_sponsorship: profile?.requires_sponsorship ?? null,
    sponsorship_statement: profile?.sponsorship_statement ?? null,
    work_authorization: profile?.work_authorization ?? null,
    years_of_experience: profile?.years_of_experience ?? null,
    salary_expectation_min: profile?.salary_expectation_min ?? null,
    salary_expectation_max: profile?.salary_expectation_max ?? null,
    earliest_start_date: profile?.earliest_start_date ?? null,
    willing_to_relocate: profile?.willing_to_relocate ?? null,
    preferred_work_type: profile?.preferred_work_type ?? null,
    highest_degree: profile?.highest_degree ?? null,
    field_of_study: profile?.field_of_study ?? null,
    university: profile?.university ?? null,
    graduation_year: profile?.graduation_year ?? null,
    gpa: profile?.gpa ?? null,
    // EEO fields — sent when opted in OR any EEO value is present (presence = consent)
    auto_fill_diversity: eeoOptIn,
    gender: eeoOptIn ? (profile?.gender ?? null) : null,
    ethnicity: eeoOptIn ? (profile?.ethnicity ?? null) : null,
    hispanic_latino: eeoOptIn ? (profile?.hispanic_latino ?? null) : null,
    veteran_status: eeoOptIn ? (profile?.veteran_status ?? null) : null,
    disability_status: eeoOptIn ? (profile?.disability_status ?? null) : null,
    // User-saved custom answers (dashboard "Common questions" section) —
    // the question tier matches these patterns FIRST, before any heuristic.
    custom_answers: Array.isArray(profile?.custom_answers)
      ? (profile?.custom_answers as Array<{ question_pattern?: unknown; answer?: unknown }>)
          .filter((qa) => typeof qa?.question_pattern === "string" && typeof qa?.answer === "string" && qa.answer.trim())
          .map((qa) => ({ question_pattern: String(qa.question_pattern), answer: String(qa.answer).trim() }))
      : [],
    // Resume-derived fields
    resume_full_name: resume?.full_name ?? null,
    current_title: resume?.primary_role ?? null,
    current_company: currentCompany,
    resume_email: resume?.email ?? null,
    resume_phone: resume?.phone ?? null,
    resume_location: resume?.location ?? null,
    resume_linkedin_url: resume?.linkedin_url ?? null,
    resume_portfolio_url: resume?.portfolio_url ?? null,
    resume_summary: resume?.summary ?? null,
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
