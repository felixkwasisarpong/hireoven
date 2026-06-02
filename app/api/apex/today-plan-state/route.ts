import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getApexPlanExecutionSummary } from "@/lib/apex/plan/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

type UpdateBody = {
  itemId?: string
  title?: string
  eyebrow?: string
  query?: string
  status?: "done" | "deferred" | null
  recordRun?: boolean
}

type PlanStateRow = {
  item_id: string
  status: "done" | "deferred" | null
  updated_at: string
  run_count: number
  last_run_at: string | null
}

type DailySummaryRow = {
  plan_date: string
  run_count: number
  done_count: number
  deferred_count: number
}

type HistoryRow = {
  item_id: string
  title: string | null
  eyebrow: string | null
  query: string | null
  status: "done" | "deferred" | null
  plan_date: string
  updated_at: string
  run_count: number
  last_run_at: string | null
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return jsonError(401, "Unauthorized")

  const pool = getPostgresPool()

  try {
    const [result, summary, dailyResult, historyResult] = await Promise.all([
      pool.query<PlanStateRow>(
        `SELECT item_id, status, updated_at, run_count, last_run_at
         FROM apex_today_plan_state
         WHERE user_id = $1
           AND plan_date = $2::date`,
        [user.id, todayStr()]
      ),
      getApexPlanExecutionSummary(user.id),
      pool.query<DailySummaryRow>(
        `SELECT
           plan_date::text AS plan_date,
           COALESCE(SUM(run_count), 0)::int AS run_count,
           COUNT(*) FILTER (WHERE status = 'done')::int AS done_count,
           COUNT(*) FILTER (WHERE status = 'deferred')::int AS deferred_count
         FROM apex_today_plan_state
         WHERE user_id = $1
           AND plan_date >= CURRENT_DATE - INTERVAL '6 days'
         GROUP BY plan_date
         ORDER BY plan_date DESC`,
        [user.id]
      ),
      pool.query<HistoryRow>(
        `SELECT
           item_id,
           title,
           eyebrow,
           query,
           status,
           plan_date::text AS plan_date,
           updated_at,
           run_count,
           last_run_at
         FROM apex_today_plan_state
         WHERE user_id = $1
           AND plan_date >= CURRENT_DATE - INTERVAL '6 days'
           AND (run_count > 0 OR status IS NOT NULL)
         ORDER BY plan_date DESC, COALESCE(last_run_at, updated_at) DESC
         LIMIT 10`,
        [user.id]
      ),
    ])

    const items = Object.fromEntries(
      result.rows.map((row) => [
        row.item_id,
        {
          status: row.status,
          updatedAt: row.updated_at,
          runCount: row.run_count,
          lastRunAt: row.last_run_at,
        },
      ])
    )

    return NextResponse.json({
      items,
      summary,
      daily: dailyResult.rows.map((row) => ({
        date: row.plan_date,
        runCount: row.run_count,
        doneCount: row.done_count,
        deferredCount: row.deferred_count,
      })),
      history: historyResult.rows.map((row) => ({
        itemId: row.item_id,
        title: row.title,
        eyebrow: row.eyebrow,
        query: row.query,
        status: row.status,
        planDate: row.plan_date,
        updatedAt: row.updated_at,
        runCount: row.run_count,
        lastRunAt: row.last_run_at,
      })),
    })
  } catch (error) {
    console.error("[apex/today-plan-state] GET error", error)
    return jsonError(500, "Unable to load Today Plan state right now.")
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return jsonError(401, "Unauthorized")

  const body = (await request.json().catch(() => null)) as UpdateBody | null
  const status = body?.status ?? null
  const recordRun = body?.recordRun === true

  if (!body?.itemId?.trim()) {
    return jsonError(400, "itemId is required")
  }

  if (status !== null && status !== "done" && status !== "deferred") {
    return jsonError(400, "Invalid status")
  }

  const pool = getPostgresPool()
  const itemId = body.itemId.trim()
  const now = new Date().toISOString()

  try {
    const result = await pool.query<PlanStateRow>(
      `INSERT INTO apex_today_plan_state (
         id,
         user_id,
         plan_date,
         item_id,
         title,
         eyebrow,
         query,
         status,
         run_count,
         last_run_at
       )
       VALUES (
         $1,
         $2,
         $3::date,
         $4,
         NULLIF($5, ''),
         NULLIF($6, ''),
         NULLIF($7, ''),
         $8,
         $9,
         $10::timestamptz
       )
       ON CONFLICT (user_id, plan_date, item_id)
       DO UPDATE SET
         title = COALESCE(EXCLUDED.title, apex_today_plan_state.title),
         eyebrow = COALESCE(EXCLUDED.eyebrow, apex_today_plan_state.eyebrow),
         query = COALESCE(EXCLUDED.query, apex_today_plan_state.query),
         status = EXCLUDED.status,
         run_count = apex_today_plan_state.run_count + EXCLUDED.run_count,
         last_run_at = COALESCE(EXCLUDED.last_run_at, apex_today_plan_state.last_run_at),
         updated_at = NOW()
       RETURNING item_id, status, updated_at, run_count, last_run_at`,
      [
        randomUUID(),
        user.id,
        todayStr(),
        itemId,
        body.title ?? "",
        body.eyebrow ?? "",
        body.query ?? "",
        status,
        recordRun ? 1 : 0,
        recordRun ? now : null,
      ]
    )

    const row = result.rows[0]

    return NextResponse.json({
      item: row
        ? {
            itemId: row.item_id,
            status: row.status,
            updatedAt: row.updated_at,
            runCount: row.run_count,
            lastRunAt: row.last_run_at,
          }
        : null,
    })
  } catch (error) {
    console.error("[apex/today-plan-state] PUT error", error)
    return jsonError(500, "Unable to update Today Plan state right now.")
  }
}
