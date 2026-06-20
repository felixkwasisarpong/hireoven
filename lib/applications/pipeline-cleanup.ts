import { getPostgresPool } from "@/lib/postgres/server"

const TERMINAL_STATUSES = ["rejected", "withdrawn"] as const
const DEFAULT_DAYS = 7

export async function purgeStaleTerminalApplications(opts?: { olderThanDays?: number }) {
  const pool = await getPostgresPool()
  const days = opts?.olderThanDays ?? DEFAULT_DAYS

  const result = await pool.query<{ count: string }>(
    `DELETE FROM job_applications
     WHERE status = ANY($1::text[])
       AND updated_at < NOW() - ($2 || ' days')::interval
     RETURNING id`,
    [TERMINAL_STATUSES, days]
  )

  return { deleted: result.rowCount ?? 0, olderThanDays: days }
}
