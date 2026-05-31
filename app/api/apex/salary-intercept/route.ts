import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { checkSalaryBeforeApply } from "@/lib/apex/salary/pre-apply-interceptor"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")

  if (!jobId) return NextResponse.json({ intercept: null })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ intercept: null })

  try {
    const intercept = await checkSalaryBeforeApply(user.id, jobId)
    return NextResponse.json({ intercept })
  } catch {
    return NextResponse.json({ intercept: null })
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ ok: false }) }

  const { jobId, jobTitle, companyName, jobSalaryMax, userMarketP50, shortfallPct, actionTaken } =
    body as {
      jobId?: string
      jobTitle?: string
      companyName?: string
      jobSalaryMax?: number
      userMarketP50?: number
      shortfallPct?: number
      actionTaken?: string
    }

  const validActions = new Set(["apply_anyway", "skipped", "find_better"])
  if (!validActions.has(actionTaken ?? "")) return NextResponse.json({ ok: false })

  try {
    const pool = getPostgresPool()
    await pool.query(
      `INSERT INTO public.salary_intercept_events
         (user_id, job_id, job_title, company_name, job_salary_max, user_market_p50, shortfall_pct, action_taken)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user.id, jobId ?? null, jobTitle ?? null, companyName ?? null,
       jobSalaryMax ?? null, userMarketP50 ?? null, shortfallPct ?? null, actionTaken]
    )
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
