import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const WITHIN_MS: Record<string, number> = {
  '1h':  3_600_000,
  '6h':  21_600_000,
  '24h': 86_400_000,
  '3d':  259_200_000,
  '7d':  604_800_000,
}

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams
  const q          = sp.get('q')
  const companyId  = sp.get('company_id')
  const seniority  = sp.get('seniority')?.split(',').filter(Boolean)
  const empType    = sp.get('employment_type')?.split(',').filter(Boolean)
  const remote     = sp.get('remote') === 'true'
  const sponsorship = sp.get('sponsorship') === 'true'
  const within     = sp.get('within') ?? 'all'
  const sort       = sp.get('sort') ?? 'fresh'
  const limit      = Math.min(100, parseInt(sp.get('limit') ?? '24', 10))
  const offset     = parseInt(sp.get('offset') ?? '0', 10)

  const supabase = await createClient()
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()

  let query = supabase
    .from('jobs')
    .select('*, company:companies(*)', { count: 'exact' })
    .eq('is_active', true)

  if (q?.trim()) query = (query as any).ilike('title', `%${q.trim()}%`)
  if (companyId) query = query.eq('company_id', companyId)
  if (remote) query = query.eq('is_remote', true)
  if (sponsorship) query = (query as any).or('sponsors_h1b.eq.true,sponsorship_score.gt.60')
  if (seniority?.length) query = (query as any).in('seniority_level', seniority)
  if (empType?.length) query = (query as any).in('employment_type', empType)
  if (within !== 'all' && WITHIN_MS[within]) {
    const cutoff = new Date(Date.now() - WITHIN_MS[within]).toISOString()
    query = query.gte('first_detected_at', cutoff)
  }

  query = sort === 'match'
    ? query.order('sponsorship_score', { ascending: false })
    : query.order('first_detected_at', { ascending: false })

  const { data, count, error } = await query.range(offset, offset + limit - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { count: newInLastHour } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .gte('first_detected_at', oneHourAgo)

  return NextResponse.json({ jobs: data ?? [], total: count ?? 0, newInLastHour: newInLastHour ?? 0 })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const supabase = await createClient()
  const { data, error } = await (supabase.from('jobs').insert(body).select('*').single() as any)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job: data }, { status: 201 })
}
