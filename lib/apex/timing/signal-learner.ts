import { getPostgresPool } from "@/lib/postgres/server"

type ApplicationRow = {
  submitted_at: string | null
  applied_at: string | null
  company_name: string | null
  job_id: string | null
}

type CompanyRow = {
  id: string
}

export async function recordApplicationOutcome(
  applicationId: string,
  gotResponse: boolean,
): Promise<void> {
  const pool = getPostgresPool()

  // Fetch application details
  const appResult = await pool.query<ApplicationRow>(
    `SELECT submitted_at, applied_at, company_name, job_id
     FROM job_applications
     WHERE id = $1
     LIMIT 1`,
    [applicationId],
  )
  const app = appResult.rows[0]
  if (!app) return

  // Use submitted_at first, fallback to applied_at
  const timestamp = app.submitted_at ?? app.applied_at
  if (!timestamp) return

  const appliedDate = new Date(timestamp)
  const dayOfWeek = appliedDate.getDay()
  const hourOfDay = appliedDate.getHours()

  // Resolve company_id from the linked job
  let companyId: string | null = null
  if (app.job_id) {
    const companyResult = await pool.query<CompanyRow>(
      `SELECT company_id AS id FROM jobs WHERE id = $1 LIMIT 1`,
      [app.job_id],
    )
    companyId = companyResult.rows[0]?.id ?? null
  }

  // Upsert timing signal with rolling average
  if (companyId) {
    await upsertSignal(pool, companyId, dayOfWeek, hourOfDay, gotResponse)
  }
  // Always update global averages too
  await upsertSignal(pool, null, dayOfWeek, hourOfDay, gotResponse)
}

async function upsertSignal(
  pool: ReturnType<typeof getPostgresPool>,
  companyId: string | null,
  dayOfWeek: number,
  hourOfDay: number,
  gotResponse: boolean,
): Promise<void> {
  const newDataPoint = gotResponse ? 1 : 0

  if (companyId) {
    await pool.query(
      `INSERT INTO application_timing_signals
         (company_id, day_of_week, hour_of_day, screen_rate, sample_size, last_computed_at)
       VALUES ($1, $2, $3, $4, 1, now())
       ON CONFLICT (company_id, day_of_week, hour_of_day) DO UPDATE SET
         screen_rate = (
           (application_timing_signals.screen_rate * application_timing_signals.sample_size + $4)
           / (application_timing_signals.sample_size + 1)
         ),
         sample_size      = application_timing_signals.sample_size + 1,
         last_computed_at = now()`,
      [companyId, dayOfWeek, hourOfDay, newDataPoint],
    )
  } else {
    await pool.query(
      `INSERT INTO application_timing_signals
         (company_id, day_of_week, hour_of_day, screen_rate, sample_size, last_computed_at)
       VALUES (NULL, $1, $2, $3, 1, now())
       ON CONFLICT (day_of_week, hour_of_day) WHERE company_id IS NULL DO UPDATE SET
         screen_rate = (
           (application_timing_signals.screen_rate * application_timing_signals.sample_size + $3)
           / (application_timing_signals.sample_size + 1)
         ),
         sample_size      = application_timing_signals.sample_size + 1,
         last_computed_at = now()`,
      [dayOfWeek, hourOfDay, newDataPoint],
    )
  }
}
