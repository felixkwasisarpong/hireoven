import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const industry = searchParams.get('industry')
  const size = searchParams.get('size')
  const atsType = searchParams.get('ats_type')
  const sponsorsH1b = searchParams.get('sponsors_h1b')
  const hasJobs = searchParams.get('has_jobs')
  const sort = searchParams.get('sort') ?? 'job_count'
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '24', 10))
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)
  const q = searchParams.get('q')

  const supabase = await createClient()

  let query = supabase
    .from('companies')
    .select('*', { count: 'exact' })
    .eq('is_active', true)

  if (q?.trim()) {
    query = (query as any).ilike('name', `%${q.trim()}%`)
  }
  if (industry) {
    const industries = industry.split(',').map((s) => s.trim()).filter(Boolean)
    if (industries.length === 1) query = query.eq('industry', industries[0])
    else query = (query as any).in('industry', industries)
  }
  if (size) {
    const sizes = size.split(',').map((s) => s.trim()).filter(Boolean)
    if (sizes.length === 1) query = query.eq('size', sizes[0])
    else query = (query as any).in('size', sizes)
  }
  if (atsType) query = query.eq('ats_type', atsType)
  if (sponsorsH1b === 'true') query = query.eq('sponsors_h1b', true)
  if (hasJobs === 'true') query = query.gt('job_count', 0)

  const sortMap: Record<string, { col: string; asc: boolean }> = {
    job_count:             { col: 'job_count',             asc: false },
    sponsorship_confidence:{ col: 'sponsorship_confidence', asc: false },
    created_at:            { col: 'created_at',             asc: false },
    name:                  { col: 'name',                   asc: true  },
  }
  const { col, asc } = sortMap[sort] ?? sortMap.job_count
  query = query.order(col, { ascending: asc })

  const { data, count, error } = await query.range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ companies: data ?? [], total: count ?? 0 })
}
