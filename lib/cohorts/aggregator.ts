import { getPostgresPool } from "@/lib/postgres/server"
import { computeCohortStrength } from "./strength-scorer"

export async function aggregateCohortStats(cohortId: string): Promise<void> {
  const pool = getPostgresPool()

  // Aggregate member stats
  const statsResult = await pool.query<{
    member_count: string
    avg_years_experience: string | null
    avg_salary_usd: string | null
  }>(
    `SELECT
       COUNT(*)::text AS member_count,
       AVG(years_experience)::text AS avg_years_experience,
       AVG(current_salary)::text AS avg_salary_usd
     FROM public.cohort_members
     WHERE cohort_id = $1`,
    [cohortId]
  )

  const stats = statsResult.rows[0]
  const memberCount = parseInt(stats?.member_count ?? "0", 10)
  const avgYearsExp = stats?.avg_years_experience ? parseFloat(stats.avg_years_experience) : null
  const avgSalary = stats?.avg_salary_usd ? Math.round(parseFloat(stats.avg_salary_usd)) : null

  // Aggregate top 10 skills by frequency across all members
  const skillsResult = await pool.query<{ skill: string; freq: string }>(
    `SELECT skill, COUNT(*)::text AS freq
     FROM public.cohort_members, unnest(skills) AS skill
     WHERE cohort_id = $1
     GROUP BY skill
     ORDER BY freq DESC
     LIMIT 10`,
    [cohortId]
  )
  const topSkills = skillsResult.rows.map((r) => r.skill)

  // Count employer requests
  const requestResult = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM public.employer_cohort_requests
     WHERE cohort_id = $1`,
    [cohortId]
  )
  const requestCount = parseInt(requestResult.rows[0]?.cnt ?? "0", 10)

  // Fetch current status + layoff_date for status transition logic
  const cohortResult = await pool.query<{ status: string; layoff_date: string }>(
    `SELECT status, layoff_date FROM public.layoff_cohorts WHERE id = $1`,
    [cohortId]
  )
  const cohort = cohortResult.rows[0]
  if (!cohort) return

  // Determine new status
  let newStatus = cohort.status
  const daysSinceLayoff = Math.floor(
    (Date.now() - new Date(cohort.layoff_date).getTime()) / 86_400_000
  )

  if (cohort.status === "forming" && memberCount >= 5) newStatus = "active"
  // 3+ employer requests before "matching" — 1 is too low a bar.
  if (cohort.status === "active" && requestCount >= 3) newStatus = "matching"
  if ((cohort.status === "active" || cohort.status === "matching") && daysSinceLayoff >= 180)
    newStatus = "closed"

  // Write aggregated stats (strength_score written by computeCohortStrength)
  await pool.query(
    `UPDATE public.layoff_cohorts SET
       member_count = $1,
       avg_years_experience = $2,
       avg_salary_usd = $3,
       top_skills = $4,
       employer_request_count = $5,
       status = $6,
       updated_at = now()
     WHERE id = $7`,
    [memberCount, avgYearsExp, avgSalary, topSkills, requestCount, newStatus, cohortId]
  )

  await computeCohortStrength(cohortId)
}

export async function aggregateAllActiveCohorts(): Promise<void> {
  const pool = getPostgresPool()
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM public.layoff_cohorts WHERE status IN ('forming', 'active', 'matching')`
  )

  await Promise.all(result.rows.map((r) => aggregateCohortStats(r.id).catch((err) => {
    console.error(`[aggregator] Failed for cohort ${r.id}:`, err instanceof Error ? err.message : err)
  })))

  console.log(`[aggregator] Aggregated ${result.rows.length} active cohorts`)
}
