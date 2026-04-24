import { NextRequest, NextResponse } from 'next/server'
import { getPostgresPool } from '@/lib/postgres/server'
import {
  H1B_PREDICTION_CACHE_TTL_MS,
  runPrediction,
} from '@/lib/h1b/prediction-service'
import type { Company, H1BPrediction, Job } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = H1B_PREDICTION_CACHE_TTL_MS
const MAX_JOBS_PER_REQUEST = 20

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

  const pool = getPostgresPool()

  let jobs: Array<Job & { company: Company }>
  try {
    const result = await pool.query<Job & { company: Company }>(
      `SELECT j.*, to_jsonb(c.*) AS company
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.id = ANY($1::uuid[])`,
      [jobIds]
    )
    jobs = result.rows
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Database query failed' },
      { status: 500 }
    )
  }

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

    for (const [id, prediction] of computed) {
      if (prediction) predictions[id] = prediction
    }

    const updates = computed.filter((r): r is readonly [string, H1BPrediction] => r[1] !== null)

    await Promise.allSettled(
      updates.map(([id, prediction]) =>
        pool.query(
          `UPDATE jobs
           SET h1b_prediction = $1::jsonb,
               h1b_prediction_at = $2
           WHERE id = $3`,
          [JSON.stringify(prediction), new Date().toISOString(), id]
        )
      )
    )
  }

  return NextResponse.json({ predictions })
}
