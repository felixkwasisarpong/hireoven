import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
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

  const { data: sub } = await (supabase as any)
    .from('subscriptions')
    .select('plan, status')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

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

  const admin = createAdminClient()
  const { data: jobData } = await admin
    .from('jobs')
    .select('*, company:companies(*)')
    .eq('id', body.jobId)
    .maybeSingle()

  if (!jobData) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const job = jobData as Job & { company: Company }

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

  const { data: records } = await admin
    .from('lca_records')
    .select('*')
    .eq('company_id', job.company.id)
    .order('decision_date', { ascending: false })
    .limit(10)

  const analysis = await deepH1BAnalysis(
    input,
    fast,
    (records ?? []) as LCARecord[]
  )

  return NextResponse.json({ analysis, prediction: fast })
}
