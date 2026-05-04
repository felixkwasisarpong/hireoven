import { getPostgresPool } from "@/lib/postgres/server"

export async function matchCohortsToOpenRoles(): Promise<void> {
  const pool = getPostgresPool()

  // Get all active / matching cohorts with their skill sets
  const cohortResult = await pool.query<{
    id: string
    company_name: string
    top_skills: string[]
  }>(
    `SELECT id, company_name, top_skills
     FROM public.layoff_cohorts
     WHERE status IN ('active', 'matching')
       AND array_length(top_skills, 1) > 0`
  )

  for (const cohort of cohortResult.rows) {
    if (!cohort.top_skills?.length) continue

    // 1. Companies that previously made requests to this cohort — check for open roles
    const priorRequestResult = await pool.query<{ company_id: string | null }>(
      `SELECT DISTINCT company_id FROM public.employer_cohort_requests
       WHERE cohort_id = $1 AND company_id IS NOT NULL AND status = 'pending'`,
      [cohort.id]
    )

    const priorCompanyIds = priorRequestResult.rows
      .map((r) => r.company_id)
      .filter((id): id is string => id !== null)

    // 2. Companies whose open job skills overlap significantly with cohort skills
    const skillMatchResult = await pool.query<{
      company_id: string
      company_name: string
      overlap_count: string
    }>(
      `SELECT
         j.company_id,
         c.name AS company_name,
         COUNT(*)::text AS overlap_count
       FROM public.jobs j
       JOIN public.companies c ON c.id = j.company_id
       WHERE j.is_active = true
         AND j.skills && $1::text[]
         AND j.company_id IS NOT NULL
         AND j.company_id != (
           SELECT company_id FROM public.layoff_cohorts WHERE id = $2
         )
       GROUP BY j.company_id, c.name
       HAVING COUNT(*) >= 2
       ORDER BY COUNT(*) DESC
       LIMIT 20`,
      [cohort.top_skills, cohort.id]
    )

    const matchedCompanies = new Set(priorCompanyIds)
    for (const row of skillMatchResult.rows) {
      matchedCompanies.add(row.company_id)
    }

    // Create pending employer_cohort_requests for strong matches (auto-generated, not from employer)
    for (const companyId of matchedCompanies) {
      const companyRow = skillMatchResult.rows.find((r) => r.company_id === companyId)
      if (!companyRow) continue

      const overlap = parseInt(companyRow.overlap_count, 10)
      if (overlap < 3) continue // only persist high-overlap matches

      // Insert only if no existing request from this company for this cohort
      await pool.query(
        `INSERT INTO public.employer_cohort_requests
           (cohort_id, company_id, company_name, contact_email, roles_needed, headcount_requested, message, status)
         VALUES ($1, $2, $3, 'auto-matched@hireoven.com', $4::text[], 1, $5, 'pending')
         ON CONFLICT DO NOTHING`,
        [
          cohort.id,
          companyId,
          companyRow.company_name,
          cohort.top_skills.slice(0, 5),
          `Auto-matched: ${overlap} skill overlaps with ${cohort.company_name} layoff cohort`,
        ]
      )
    }

    if (matchedCompanies.size > 0) {
      console.log(`[employer-matcher] Cohort ${cohort.id} (${cohort.company_name}): ${matchedCompanies.size} potential employer matches`)
    }
  }
}
