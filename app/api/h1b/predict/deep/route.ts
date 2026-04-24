import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPostgresPool } from '@/lib/postgres/server'
import { deepH1BAnalysis, predictH1BApproval } from '@/lib/h1b/predictor'
import { canAccess, type Plan } from '@/lib/gates'
import type {
  Company,
  H1BPrediction,
  H1BPredictionInput,
  Job,
  LCARecord,
} from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pool = getPostgresPool()

  const subResult = await pool.query<{ plan: string | null; status: string | null }>(
    `SELECT plan, status
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id]
  )
  const sub = subResult.rows[0] ?? null
  const plan: Plan = ((sub?.plan as Plan | null) ?? 'free') as Plan

  if (!canAccess(plan, 'international')) {
    return NextResponse.json(
      {
        error: 'Deep H1B analysis requires Pro International.',
        upgrade: 'pro_international',
      },
      { status: 402 }
    )
  }

  let body: { jobId?: string }
  try {
    body = (await request.json()) as { jobId?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const jobResult = await pool.query<Job & { company: Company }>(
    `SELECT j.*, to_jsonb(c.*) AS company
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1
     LIMIT 1`,
    [body.jobId]
  )
  const job = jobResult.rows[0] ?? null

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const input: H1BPredictionInput = {
    jobTitle: job.title,
    normalizedTitle: job.normalized_title,
    company: { id: job.company.id, name: job.company.name },
    location: job.location,
    state: null,
    isRemote: job.is_remote,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    seniorityLevel: job.seniority_level,
    employmentType: job.employment_type,
    socCode: null,
    description: job.description,
  }

  const fast: H1BPrediction =
    (job.h1b_prediction as H1BPrediction | null) ??
    (await predictH1BApproval(input))

  if (!fast.isUSJob) {
    return NextResponse.json({
      analysis:
        'This role does not appear to be in the United States, so H1B does not apply.',
      prediction: fast,
    })
  }

  const lcaResult = await pool.query<LCARecord>(
    `SELECT *
     FROM lca_records
     WHERE company_id = $1
     ORDER BY decision_date DESC
     LIMIT 10`,
    [job.company.id]
  )

  const analysis = await deepH1BAnalysis(input, fast, lcaResult.rows)

  return NextResponse.json({ analysis, prediction: fast })
}
