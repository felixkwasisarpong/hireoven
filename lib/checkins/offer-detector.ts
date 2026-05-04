import { getPostgresPool } from "@/lib/postgres/server"

type ApplicationRow = {
  job_title: string
  company_id: string | null
  company_name: string
  offer_details: {
    base_salary?: number
    offer_deadline?: string
  } | null
}

function estimateStartDate(offerDetails: ApplicationRow["offer_details"]): string {
  // If offer has a deadline, assume start ~14 days after
  if (offerDetails?.offer_deadline) {
    const d = new Date(offerDetails.offer_deadline)
    d.setDate(d.getDate() + 14)
    return d.toISOString().split("T")[0]
  }
  // Default: 30 days from now (typical offer-to-start)
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().split("T")[0]
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export async function detectOfferAcceptance(
  userId: string,
  applicationId: string
): Promise<void> {
  const pool = getPostgresPool()

  // Fetch application details
  const appResult = await pool.query<ApplicationRow>(
    `SELECT ja.job_title, j.company_id, COALESCE(c.name, ja.company_name) AS company_name,
            ja.offer_details
     FROM job_applications ja
     LEFT JOIN jobs j ON j.id = ja.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE ja.id = $1 AND ja.user_id = $2`,
    [applicationId, userId]
  )

  const app = appResult.rows[0]
  if (!app) return

  // Prevent duplicate hired_outcomes for the same application
  const existingResult = await pool.query<{ id: string }>(
    `SELECT id FROM public.hired_outcomes WHERE job_application_id = $1`,
    [applicationId]
  )
  if (existingResult.rows.length > 0) return

  const startDate = estimateStartDate(app.offer_details)
  const finalSalary = app.offer_details?.base_salary ?? null

  // Create hired_outcomes
  const outcomeResult = await pool.query<{ id: string }>(
    `INSERT INTO public.hired_outcomes
       (user_id, job_application_id, company_id, role_title, final_salary, start_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, applicationId, app.company_id, app.job_title, finalSalary, startDate]
  )
  const outcomeId = outcomeResult.rows[0].id

  // Schedule four check-ins
  const schedule: Array<{ type: string; daysOffset: number }> = [
    { type: "day_30", daysOffset: 30 },
    { type: "day_90", daysOffset: 90 },
    { type: "day_180", daysOffset: 180 },
    { type: "day_365", daysOffset: 365 },
  ]

  for (const s of schedule) {
    await pool.query(
      `INSERT INTO public.post_hire_checkins
         (hired_outcome_id, user_id, company_id, checkin_type, scheduled_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [outcomeId, userId, app.company_id, s.type, addDays(startDate, s.daysOffset)]
    )
  }

  console.log(`[offer-detector] Created hired_outcome ${outcomeId} for user ${userId} at ${app.company_name}`)
}
