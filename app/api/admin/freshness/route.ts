import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"

type TierRow = {
  freshness_tier: string
  companies: string
  active_companies: string
  p50_lag_sec: number | null
  p95_lag_sec: number | null
  backlog: string
  jobs_last_1h: string
  jobs_last_24h: string
}

type DetectionRow = {
  samples: string
  p50_sec: number | null
  p95_sec: number | null
}

type StatusRow = {
  status: string
  count: string
}

type RunsRow = {
  runs: string
  succeeded: string
  failed: string
  jobs_inserted: string
}

const FRESHNESS_QUERY = `
WITH companies_by_tier AS (
  SELECT
    COALESCE(freshness_tier, 'tier_2') AS freshness_tier,
    COUNT(*)::bigint                                                         AS companies,
    COUNT(*) FILTER (WHERE status = 'active')::bigint                        AS active_companies,
    percentile_cont(0.50) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (now() - last_crawled_at))
    ) FILTER (WHERE last_crawled_at IS NOT NULL AND status = 'active')       AS p50_lag_sec,
    percentile_cont(0.95) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (now() - last_crawled_at))
    ) FILTER (WHERE last_crawled_at IS NOT NULL AND status = 'active')       AS p95_lag_sec,
    COUNT(*) FILTER (
      WHERE status = 'active' AND next_harvest_at IS NOT NULL AND next_harvest_at <= now()
    )::bigint                                                                AS backlog
  FROM companies
  GROUP BY 1
),
jobs_by_tier AS (
  SELECT
    COALESCE(c.freshness_tier, 'tier_2') AS freshness_tier,
    COUNT(*) FILTER (WHERE j.first_detected_at >= now() - interval '1 hour')::bigint  AS jobs_last_1h,
    COUNT(*) FILTER (WHERE j.first_detected_at >= now() - interval '24 hours')::bigint AS jobs_last_24h
  FROM jobs j
  JOIN companies c ON c.id = j.company_id
  WHERE j.first_detected_at >= now() - interval '24 hours'
  GROUP BY 1
),
tier_payload AS (
  SELECT
    t.freshness_tier,
    t.companies,
    t.active_companies,
    t.p50_lag_sec,
    t.p95_lag_sec,
    t.backlog,
    COALESCE(j.jobs_last_1h, 0)::bigint  AS jobs_last_1h,
    COALESCE(j.jobs_last_24h, 0)::bigint AS jobs_last_24h
  FROM companies_by_tier t
  LEFT JOIN jobs_by_tier j USING (freshness_tier)
),
detection AS (
  SELECT
    COUNT(*)::bigint AS samples,
    percentile_cont(0.50) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (first_detected_at - posted_at))
    ) AS p50_sec,
    percentile_cont(0.95) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (first_detected_at - posted_at))
    ) AS p95_sec
  FROM jobs
  WHERE posted_at IS NOT NULL
    AND first_detected_at IS NOT NULL
    AND first_detected_at >= now() - interval '24 hours'
    AND first_detected_at >= posted_at
),
status_counts AS (
  SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::bigint AS count
  FROM companies
  GROUP BY 1
),
recent_runs AS (
  SELECT
    COUNT(DISTINCT date_trunc('minute', crawled_at))::bigint AS runs,
    COUNT(*) FILTER (WHERE status = 'success')::bigint       AS succeeded,
    COUNT(*) FILTER (WHERE status IN ('failed','blocked','fetch_error','bad_url'))::bigint AS failed,
    COALESCE(SUM(new_jobs), 0)::bigint                        AS jobs_inserted
  FROM crawl_logs
  WHERE crawled_at >= now() - interval '24 hours'
)
SELECT
  (SELECT json_agg(t ORDER BY t.freshness_tier) FROM tier_payload t)        AS tiers,
  (SELECT row_to_json(d) FROM detection d)                                  AS detection,
  (SELECT json_agg(s ORDER BY s.status) FROM status_counts s)               AS status,
  (SELECT row_to_json(r) FROM recent_runs r)                                AS recent_runs
`

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const pool = getPostgresPool()
  try {
    const result = await pool.query<{
      tiers: TierRow[] | null
      detection: DetectionRow | null
      status: StatusRow[] | null
      recent_runs: RunsRow | null
    }>(FRESHNESS_QUERY)
    const row = result.rows[0]

    const tiers = (row?.tiers ?? []).map((t) => ({
      tier: t.freshness_tier,
      companies: Number(t.companies),
      activeCompanies: Number(t.active_companies),
      p50LagSec: t.p50_lag_sec === null ? null : Math.round(t.p50_lag_sec),
      p95LagSec: t.p95_lag_sec === null ? null : Math.round(t.p95_lag_sec),
      backlog: Number(t.backlog),
      jobsLast1h: Number(t.jobs_last_1h),
      jobsLast24h: Number(t.jobs_last_24h),
    }))

    const detection = row?.detection
      ? {
          samples: Number(row.detection.samples),
          p50Sec: row.detection.p50_sec === null ? null : Math.round(row.detection.p50_sec),
          p95Sec: row.detection.p95_sec === null ? null : Math.round(row.detection.p95_sec),
        }
      : { samples: 0, p50Sec: null, p95Sec: null }

    const status = (row?.status ?? []).map((s) => ({
      status: s.status,
      count: Number(s.count),
    }))

    const recentRuns = row?.recent_runs
      ? {
          runs: Number(row.recent_runs.runs),
          succeeded: Number(row.recent_runs.succeeded),
          failed: Number(row.recent_runs.failed),
          jobsInserted: Number(row.recent_runs.jobs_inserted),
        }
      : { runs: 0, succeeded: 0, failed: 0, jobsInserted: 0 }

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        tiers,
        detection,
        status,
        recentRuns,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    )
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
