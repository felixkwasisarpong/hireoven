import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runPrediction } from '@/app/api/h1b/predict/route'
import type { Company, H1BPrediction, Job } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days
const MAX_JOBS_PER_REQUEST = 20

/**
 * Batch-predict H1B approval for up to 20 jobs at a time.
 * Returns { [jobId]: H1BPrediction } — missing jobs are simply omitted.
 * Cached predictions <7 days old are served from the `jobs.h1b_prediction`
 * JSONB column; everything else is computed in parallel.
 */
export async function POST(request: NextRequest) {
  let body: { jobIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const jobIds = Array.isArray(body.jobIds)
    ? body.jobIds.filter((x): x is string => typeof x === 'string').slice(0, MAX_JOBS_PER_REQUEST)
    : []

  if (jobIds.length === 0) {
    return NextResponse.json({ predictions: {} })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('jobs')
    .select('*, company:companies(*)')
    .in('id', jobIds)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const jobs = (data ?? []) as Array<Job & { company: Company }>

  const now = Date.now()
  const predictions: Record<string, H1BPrediction> = {}
  const toCompute: Array<Job & { company: Company }> = []

  for (const job of jobs) {
    const cached = job.h1b_prediction
    const cachedAt = job.h1b_prediction_at
      ? new Date(job.h1b_prediction_at).getTime()
      : 0
    if (cached && now - cachedAt < CACHE_TTL_MS) {
      predictions[job.id] = cached as H1BPrediction
    } else {
      toCompute.push(job)
    }
  }

  if (toCompute.length > 0) {
    const computed = await Promise.all(
      toCompute.map(async (job) => {
        try {
          return [job.id, await runPrediction(job)] as const
        } catch (err) {
          console.error('predict job failed', job.id, err)
          return [job.id, null] as const
        }
      })
    )

    const updates = computed
      .filter((r): r is readonly [string, H1BPrediction] => r[1] !== null)
      .map(([id, prediction]) => ({
        id,
        prediction,
      }))

    for (const [id, prediction] of computed) {
      if (prediction) predictions[id] = prediction
    }

    // Fire-and-forget cache write. We await to keep the TTL honest but don't
    // block the response on individual failures.
    await Promise.allSettled(
      updates.map(({ id, prediction }) =>
        (supabase.from('jobs') as any)
          .update({
            h1b_prediction: prediction,
            h1b_prediction_at: new Date().toISOString(),
          })
          .eq('id', id)
      )
    )
  }

  return NextResponse.json({ predictions })
}
