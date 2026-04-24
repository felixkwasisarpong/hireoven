import { getPostgresPool } from "@/lib/postgres/server"
import type { ApiUsageInsert } from "@/types"

export async function logApiUsage(entry: ApiUsageInsert) {
  try {
    const pool = getPostgresPool()
    await pool.query(
      `INSERT INTO api_usage (service, operation, tokens_used, cost_usd)
       VALUES ($1, $2, $3, $4)`,
      [
        entry.service,
        entry.operation ?? null,
        entry.tokens_used ?? null,
        entry.cost_usd ?? null,
      ]
    )
  } catch (error) {
    console.error("Failed to log api_usage", error)
  }
}
