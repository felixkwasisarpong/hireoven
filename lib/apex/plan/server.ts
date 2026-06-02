import { getPostgresPool } from "@/lib/postgres/server"

export type ApexPlanExecutionSummary = {
  today: {
    runCount: number
    doneCount: number
    deferredCount: number
  }
  trailing7d: {
    runCount: number
    doneCount: number
    deferredCount: number
    activeDays: number
  }
  frequentDeferredTitles: string[]
  frequentCompletedTitles: string[]
  executionFingerprint: string
}

type AggregateRow = {
  today_run_count: number | null
  today_done_count: number | null
  today_deferred_count: number | null
  trailing_run_count: number | null
  trailing_done_count: number | null
  trailing_deferred_count: number | null
  trailing_active_days: number | null
}

type TitleRow = {
  label: string | null
}

export async function getApexPlanExecutionSummary(userId: string): Promise<ApexPlanExecutionSummary> {
  const pool = getPostgresPool()

  const [aggregateResult, deferredResult, completedResult] = await Promise.all([
    pool.query<AggregateRow>(
      `SELECT
         COALESCE(SUM(run_count) FILTER (WHERE plan_date = CURRENT_DATE), 0)::int AS today_run_count,
         COUNT(*) FILTER (WHERE plan_date = CURRENT_DATE AND status = 'done')::int AS today_done_count,
         COUNT(*) FILTER (WHERE plan_date = CURRENT_DATE AND status = 'deferred')::int AS today_deferred_count,
         COALESCE(SUM(run_count), 0)::int AS trailing_run_count,
         COUNT(*) FILTER (WHERE status = 'done')::int AS trailing_done_count,
         COUNT(*) FILTER (WHERE status = 'deferred')::int AS trailing_deferred_count,
         COUNT(DISTINCT plan_date) FILTER (WHERE run_count > 0 OR status IS NOT NULL)::int AS trailing_active_days
       FROM apex_today_plan_state
       WHERE user_id = $1
         AND plan_date >= CURRENT_DATE - INTERVAL '6 days'`,
      [userId]
    ),
    pool.query<TitleRow>(
      `SELECT COALESCE(NULLIF(title, ''), item_id) AS label
       FROM apex_today_plan_state
       WHERE user_id = $1
         AND plan_date >= CURRENT_DATE - INTERVAL '6 days'
         AND status = 'deferred'
       GROUP BY 1
       ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
       LIMIT 3`,
      [userId]
    ),
    pool.query<TitleRow>(
      `SELECT COALESCE(NULLIF(title, ''), item_id) AS label
       FROM apex_today_plan_state
       WHERE user_id = $1
         AND plan_date >= CURRENT_DATE - INTERVAL '6 days'
         AND (status = 'done' OR run_count > 0)
       GROUP BY 1
       ORDER BY SUM(run_count) DESC, MAX(updated_at) DESC
       LIMIT 3`,
      [userId]
    ),
  ])

  const aggregate = aggregateResult.rows[0]

  const summary: ApexPlanExecutionSummary = {
    today: {
      runCount: aggregate?.today_run_count ?? 0,
      doneCount: aggregate?.today_done_count ?? 0,
      deferredCount: aggregate?.today_deferred_count ?? 0,
    },
    trailing7d: {
      runCount: aggregate?.trailing_run_count ?? 0,
      doneCount: aggregate?.trailing_done_count ?? 0,
      deferredCount: aggregate?.trailing_deferred_count ?? 0,
      activeDays: aggregate?.trailing_active_days ?? 0,
    },
    frequentDeferredTitles: deferredResult.rows.map((row) => row.label).filter((value): value is string => Boolean(value)),
    frequentCompletedTitles: completedResult.rows.map((row) => row.label).filter((value): value is string => Boolean(value)),
    executionFingerprint: "",
  }

  summary.executionFingerprint = [
    summary.today.runCount,
    summary.today.doneCount,
    summary.today.deferredCount,
    summary.trailing7d.runCount,
    summary.trailing7d.doneCount,
    summary.trailing7d.deferredCount,
    summary.trailing7d.activeDays,
    summary.frequentDeferredTitles[0] ?? "_",
    summary.frequentCompletedTitles[0] ?? "_",
  ].join("|")

  return summary
}
