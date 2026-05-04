import { getPostgresPool } from "@/lib/postgres/server"

type CohortStatsRow = {
  member_count: number
  avg_years_experience: string | null
  top_skills: string[]
  employer_request_count: number
  vouch_count: string
}

export async function computeCohortStrength(cohortId: string): Promise<number> {
  const pool = getPostgresPool()

  const [cohortRow, vouchRow] = await Promise.all([
    pool.query<CohortStatsRow>(
      `SELECT
         member_count,
         avg_years_experience,
         top_skills,
         employer_request_count
       FROM public.layoff_cohorts
       WHERE id = $1`,
      [cohortId]
    ),
    pool.query<{ vouch_count: string }>(
      `SELECT COUNT(*)::text AS vouch_count
       FROM public.cohort_vouches
       WHERE cohort_id = $1`,
      [cohortId]
    ),
  ])

  const c = cohortRow.rows[0]
  if (!c) return 0

  const memberCount = c.member_count
  const avgYearsExp = c.avg_years_experience != null ? parseFloat(c.avg_years_experience) : 0
  const skillCount = c.top_skills.length
  const requestCount = c.employer_request_count
  const vouchCount = parseInt(vouchRow.rows[0]?.vouch_count ?? "0", 10)
  const vouchDensity = memberCount > 0 ? vouchCount / memberCount : 0

  // Member count: 30 pts max
  let score = 0
  if (memberCount >= 200) score += 30
  else if (memberCount >= 100) score += 24
  else if (memberCount >= 50) score += 18
  else if (memberCount >= 20) score += 12
  else score += 6

  // Avg years experience: 20 pts max
  if (avgYearsExp >= 8) score += 20
  else if (avgYearsExp >= 5) score += 15
  else if (avgYearsExp >= 3) score += 10
  else score += 5

  // Vouch density: 20 pts max
  if (vouchDensity >= 0.5) score += 20
  else if (vouchDensity >= 0.3) score += 14
  else if (vouchDensity >= 0.1) score += 8
  else score += 2

  // Skill diversity: 15 pts max
  if (skillCount >= 10) score += 15
  else if (skillCount >= 6) score += 10
  else if (skillCount >= 3) score += 6
  else score += 2

  // Employer request count: 15 pts max
  if (requestCount >= 10) score += 15
  else if (requestCount >= 5) score += 10
  else if (requestCount >= 1) score += 5

  const finalScore = Math.min(100, Math.max(0, score))

  await pool.query(
    `UPDATE public.layoff_cohorts SET strength_score = $1, updated_at = now() WHERE id = $2`,
    [finalScore, cohortId]
  )

  return finalScore
}
