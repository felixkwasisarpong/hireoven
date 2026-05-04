import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function GET() {
  const pool = getPostgresPool()

  const [countsBySource, activeFreezeCount, recentCompanies, reviewCount, importTimes] =
    await Promise.all([
      pool.query<{ source: string; count: string }>(
        `SELECT source, COUNT(*)::text AS count FROM layoff_events GROUP BY source ORDER BY source`
      ).catch(() => ({ rows: [] as { source: string; count: string }[] })),

      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM company_layoff_summary WHERE has_active_freeze = true`
      ).catch(() => ({ rows: [{ count: "0" }] })),

      pool.query<{ name: string; event_date: string; employees_affected: number | null; freeze_confidence: string | null }>(
        `SELECT c.name, cls.most_recent_layoff_date::text AS event_date,
                cls.total_employees_affected AS employees_affected,
                cls.freeze_confidence
         FROM company_layoff_summary cls
         JOIN companies c ON c.id = cls.company_id
         WHERE cls.has_active_freeze = true
         ORDER BY cls.most_recent_layoff_date DESC
         LIMIT 10`
      ).catch(() => ({ rows: [] as { name: string; event_date: string; employees_affected: number | null; freeze_confidence: string | null }[] })),

      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM layoff_match_review WHERE reviewed = false`
      ).catch(() => ({ rows: [{ count: "0" }] })),

      pool.query<{ source: string; last_import: string | null }>(
        `SELECT source, MAX(created_at)::text AS last_import
         FROM layoff_events
         GROUP BY source`
      ).catch(() => ({ rows: [] as { source: string; last_import: string | null }[] })),
    ])

  const totalBySource = Object.fromEntries(
    countsBySource.rows.map(r => [r.source, Number(r.count)])
  )

  return NextResponse.json({
    totalEventsBySource: totalBySource,
    totalEvents: Object.values(totalBySource).reduce((s, n) => s + n, 0),
    companiesWithActiveFreeeze: Number(activeFreezeCount.rows[0]?.count ?? 0),
    lastImportBySource: Object.fromEntries(
      importTimes.rows.map(r => [r.source, r.last_import])
    ),
    topRecentLayoffs: recentCompanies.rows,
    matchReviewQueueSize: Number(reviewCount.rows[0]?.count ?? 0),
  })
}
