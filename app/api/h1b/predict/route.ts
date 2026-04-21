import { NextRequest, NextResponse } from 'next/server'
import { predictForJob } from '@/lib/h1b/prediction-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const force = request.nextUrl.searchParams.get('force') === 'true'
  const { prediction, cached } = await predictForJob(jobId, { force })
  if (!prediction) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json({ prediction, cached })
}
