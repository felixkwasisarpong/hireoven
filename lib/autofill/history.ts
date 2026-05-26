import { getPostgresPool } from "@/lib/postgres/server"

export type AutofillHistoryEntry = {
  id: string
  job_id: string | null
  company_name: string | null
  job_title: string | null
  ats_type: string | null
  fields_filled: number
  fields_total: number
  fill_rate: number | null
  applied_at: string
}

export type AutofillHistorySummary = {
  history: AutofillHistoryEntry[]
  totalApplications: number
  avgFillRate: number
  minutesSaved: number
}

export function summarizeAutofillHistory(history: AutofillHistoryEntry[]): AutofillHistorySummary {
  const totalApplications = history.length
  const avgFillRate =
    totalApplications > 0
      ? Math.round(
          history.reduce((acc, entry) => acc + (entry.fill_rate ?? 0), 0) / totalApplications,
        )
      : 0

  // Rough time saved: ~12 min per application on average.
  const minutesSaved = totalApplications * 12

  return {
    history,
    totalApplications,
    avgFillRate,
    minutesSaved,
  }
}

export async function fetchAutofillHistoryForUser(userId: string): Promise<AutofillHistorySummary> {
  const pool = getPostgresPool()
  const result = await pool.query<AutofillHistoryEntry>(
    `SELECT *
     FROM autofill_history
     WHERE user_id = $1::uuid
     ORDER BY applied_at DESC
     LIMIT 100`,
    [userId],
  )

  return summarizeAutofillHistory(result.rows)
}
