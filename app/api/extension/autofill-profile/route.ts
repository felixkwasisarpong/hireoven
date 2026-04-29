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

export async function GET(request: Request) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const pool = getPostgresPool()
  const result = await pool.query<AutofillProfile>(
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
    veteran_status: profile.auto_fill_diversity ? (profile.veteran_status ?? null) : null,
    disability_status: profile.auto_fill_diversity ? (profile.disability_status ?? null) : null,
  }

  return NextResponse.json(
    { profile: safeProfile, profileMissing: false },
    { status: 200, headers }
  )
}
