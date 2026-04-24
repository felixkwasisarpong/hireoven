import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const pool = getPostgresPool()

    const [companiesResult, jobsResult, crawlResult] = await Promise.all([
      pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM companies WHERE is_active = true"),
      pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM jobs WHERE is_active = true"),
      pool.query<{ crawled_at: string | null }>(
        "SELECT crawled_at FROM crawl_logs ORDER BY crawled_at DESC LIMIT 1"
      ),
    ])

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "connected",
      lastCrawl: crawlResult.rows[0]?.crawled_at ?? null,
      activeJobs: Number(jobsResult.rows[0]?.count ?? 0),
      activeCompanies: Number(companiesResult.rows[0]?.count ?? 0),
    })
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        database: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
