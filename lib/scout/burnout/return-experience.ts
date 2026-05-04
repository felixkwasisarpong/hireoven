import { getPostgresPool } from "@/lib/postgres/server"

export type ReturnJob = {
  jobId: string
  jobTitle: string
  companyName: string
  matchScore: number | null
  location: string | null
  isRemote: boolean
}

export type ApplicationStatusUpdate = {
  jobTitle: string
  companyName: string
  oldStatus: string
  newStatus: string
}

export type ReturnExperience = {
  welcomeMessage: string
  newMatchesSinceLastVisit: ReturnJob[]
  cohortUpdatesSinceLastVisit: string | null
  applicationStatusUpdates: ApplicationStatusUpdate[]
  suggestedFirstAction: string
}

export async function buildReturnExperience(
  userId: string,
  daysAbsent: number
): Promise<ReturnExperience> {
  const pool = getPostgresPool()

  const sinceDate = new Date(Date.now() - daysAbsent * 86_400_000).toISOString()

  const [jobsResult, cohortResult, appUpdatesResult] = await Promise.all([
    // New high-match jobs added since last visit
    pool.query<{
      id: string
      title: string
      company_name: string | null
      location: string | null
      is_remote: boolean
      match_score: number | null
    }>(
      `SELECT j.id, j.title, c.name AS company_name, j.location, j.is_remote,
              jms.overall_score AS match_score
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       LEFT JOIN job_match_scores jms ON jms.job_id = j.id AND jms.user_id = $1
       WHERE j.is_active = true
         AND j.first_detected_at >= $2
       ORDER BY COALESCE(jms.overall_score, 0) DESC
       LIMIT 5`,
      [userId, sinceDate]
    ),
    // Cohort updates
    pool.query<{ company_name: string; member_count: number; employer_request_count: number }>(
      `SELECT lc.company_name, lc.member_count, lc.employer_request_count
       FROM cohort_members cm
       JOIN layoff_cohorts lc ON lc.id = cm.cohort_id
       WHERE cm.user_id = $1
         AND lc.status IN ('active', 'matching')
       ORDER BY lc.strength_score DESC
       LIMIT 1`,
      [userId]
    ),
    // Application status changes since last visit
    pool.query<{ job_title: string; company_name: string; old_status: string; current_status: string }>(
      `SELECT ja.job_title, ja.company_name, ja.status AS current_status,
              'applied' AS old_status
       FROM job_applications ja
       WHERE ja.user_id = $1
         AND ja.updated_at >= $2
         AND ja.status IN ('phone_screen', 'interview', 'final_round', 'offer', 'rejected')
         AND ja.is_archived = false
       ORDER BY ja.updated_at DESC
       LIMIT 5`,
      [userId, sinceDate]
    ),
  ])

  const newJobs = jobsResult.rows.map((r) => ({
    jobId: r.id,
    jobTitle: r.title,
    companyName: r.company_name ?? "Unknown",
    matchScore: r.match_score,
    location: r.location,
    isRemote: r.is_remote,
  }))

  const cohort = cohortResult.rows[0]
  const cohortUpdate = cohort
    ? `Your ${cohort.company_name} cohort now has ${cohort.member_count} members${cohort.employer_request_count > 0 ? ` and ${cohort.employer_request_count} employer request${cohort.employer_request_count !== 1 ? "s" : ""}` : ""}.`
    : null

  const appUpdates: ApplicationStatusUpdate[] = appUpdatesResult.rows.map((r) => ({
    jobTitle: r.job_title,
    companyName: r.company_name,
    oldStatus: r.old_status,
    newStatus: r.current_status,
  }))

  // Warm welcome — never mention how long they were gone
  const welcomeMessage =
    newJobs.length > 0
      ? `Welcome back. There are ${newJobs.length} new role${newJobs.length !== 1 ? "s" : ""} that look like strong matches for you.`
      : appUpdates.length > 0
        ? `Welcome back. There have been some updates on your applications while you were away.`
        : `Welcome back. Your saved jobs are here — ready to pick back up whenever you are.`

  const suggestedFirstAction =
    appUpdates.some((u) => u.newStatus === "phone_screen" || u.newStatus === "interview")
      ? "Check your active applications — there may be responses that need attention."
      : newJobs.length > 0
        ? `Review the ${newJobs.length} new role${newJobs.length !== 1 ? "s" : ""} that matched your profile since your last visit.`
        : "Pick up where you left off — your saved roles are a good place to start."

  return {
    welcomeMessage,
    newMatchesSinceLastVisit: newJobs,
    cohortUpdatesSinceLastVisit: cohortUpdate,
    applicationStatusUpdates: appUpdates,
    suggestedFirstAction,
  }
}
