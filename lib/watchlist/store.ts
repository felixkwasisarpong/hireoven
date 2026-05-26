import type { Pool, PoolClient } from "pg"
import type { WatchlistWithCompany } from "@/types"

type DbExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">

type WatchlistRow = WatchlistWithCompany & {
  total_count: string
}

export async function listWatchlistWithCompany(args: {
  db: DbExecutor
  userId: string
  limit?: number
}): Promise<{ rows: WatchlistWithCompany[]; totalCount: number }> {
  const { db, userId } = args
  const limit =
    typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
      ? Math.floor(args.limit)
      : null

  const query =
    limit === null
      ? `SELECT w.*, to_jsonb(c.*) AS company, COUNT(*) OVER() AS total_count
         FROM watchlist w
         JOIN companies c ON c.id = w.company_id
         WHERE w.user_id = $1
         ORDER BY w.created_at DESC`
      : `SELECT w.*, to_jsonb(c.*) AS company, COUNT(*) OVER() AS total_count
         FROM watchlist w
         JOIN companies c ON c.id = w.company_id
         WHERE w.user_id = $1
         ORDER BY w.created_at DESC
         LIMIT $2`

  const result = limit === null
    ? await db.query<WatchlistRow>(query, [userId])
    : await db.query<WatchlistRow>(query, [userId, limit])

  const rows = result.rows.map(({ total_count, ...row }) => row)
  const totalCount = Number(result.rows[0]?.total_count ?? rows.length)
  return { rows, totalCount }
}
