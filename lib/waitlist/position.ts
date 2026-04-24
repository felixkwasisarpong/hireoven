import { getPostgresPool } from "@/lib/postgres/server"

/** 1-based position: earlier joiners get lower numbers. */
export async function getWaitlistPosition(joinedAt: string) {
  const pool = getPostgresPool()
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM waitlist
     WHERE joined_at <= $1`,
    [joinedAt]
  )
  return Number(result.rows[0]?.count ?? 1)
}
