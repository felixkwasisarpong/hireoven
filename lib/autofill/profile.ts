import { getPostgresPool } from "@/lib/postgres/server"
import type { AutofillProfile } from "@/types"

export async function getExistingAutofillProfile(userId: string): Promise<AutofillProfile | null> {
  const pool = getPostgresPool()
  const result = await pool.query<AutofillProfile>(
    `SELECT *
     FROM autofill_profiles
     WHERE user_id = $1::uuid
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId],
  )

  return result.rows[0] ?? null
}

export function calcAutofillCompletion(profile: Partial<AutofillProfile>): number {
  const required: Array<keyof AutofillProfile> = [
    "first_name",
    "last_name",
    "email",
    "phone",
    "linkedin_url",
    "work_authorization",
    "years_of_experience",
    "salary_expectation_min",
    "highest_degree",
    "university",
  ]
  const optional: Array<keyof AutofillProfile> = [
    "github_url",
    "portfolio_url",
    "city",
    "state",
    "earliest_start_date",
    "gpa",
  ]

  const reqFilled = required.filter((key) => {
    const value = profile[key]
    return value !== null && value !== undefined && value !== ""
  }).length

  const optFilled = optional.filter((key) => {
    const value = profile[key]
    return value !== null && value !== undefined && value !== ""
  }).length

  const customBonus = Array.isArray(profile.custom_answers) && profile.custom_answers.length > 0 ? 5 : 0
  const maxScore = required.length * 10 + optional.length * 5 + 5
  const score = reqFilled * 10 + optFilled * 5 + customBonus
  return Math.round((score / maxScore) * 100)
}

export async function fetchAutofillProfileSummaryForUser(userId: string): Promise<{
  profile: AutofillProfile | null
  completion: number
  completionPct: number
}> {
  const profile = await getExistingAutofillProfile(userId)
  const completion = profile ? calcAutofillCompletion(profile) : 0

  return {
    profile,
    completion,
    completionPct: completion,
  }
}
