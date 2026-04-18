import { createClient } from '@/lib/supabase/client'
import type { Company, Job, JobFilters, JobWithCompany } from '@/types'

const PAGE_SIZE = 24

function buildJobQuery(
  supabase: ReturnType<typeof createClient>,
  query: string,
  filters: JobFilters,
  limit: number,
  offset: number,
) {
  let q = supabase
    .from('jobs')
    .select('*, company:companies(*)', { count: 'exact' })
    .eq('is_active', true)

  if (query.trim()) {
    q = (q as any).textSearch('search_vector', query.trim(), { type: 'websearch' })
  }

  if (filters.remote) q = q.eq('is_remote', true)
  if (filters.sponsorship) q = (q as any).or('sponsors_h1b.eq.true,sponsorship_score.gt.60')
  if (filters.seniority?.length) q = (q as any).in('seniority_level', filters.seniority)
  if (filters.employment_type?.length) q = (q as any).in('employment_type', filters.employment_type)
  if (filters.company_ids?.length) q = (q as any).in('company_id', filters.company_ids)

  if (filters.within && filters.within !== 'all') {
    const ms: Record<string, number> = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000, '3d': 259_200_000 }
    const cutoff = new Date(Date.now() - (ms[filters.within] ?? 0)).toISOString()
    q = q.gte('first_detected_at', cutoff)
  }

  return q
    .order('first_detected_at', { ascending: false })
    .range(offset, offset + limit - 1)
}

export async function searchJobs(
  query: string,
  filters: JobFilters = {},
  limit = PAGE_SIZE,
  offset = 0,
): Promise<{ jobs: JobWithCompany[]; total: number }> {
  const supabase = createClient()
  const { data, count, error } = await (buildJobQuery(supabase, query, filters, limit, offset) as any)

  if (error) {
    // fall back to ilike if full text search column doesn't exist yet
    if (error.code === '42703' || error.message?.includes('search_vector')) {
      const fallback = supabase
        .from('jobs')
        .select('*, company:companies(*)', { count: 'exact' })
        .eq('is_active', true)
        .ilike('title', `%${query.trim()}%`)
        .order('first_detected_at', { ascending: false })
        .range(offset, offset + limit - 1)

      const { data: fb, count: fc } = await (fallback as any)
      return { jobs: (fb ?? []) as JobWithCompany[], total: fc ?? 0 }
    }
    return { jobs: [], total: 0 }
  }

  return { jobs: (data ?? []) as JobWithCompany[], total: count ?? 0 }
}

export async function searchCompanies(
  query: string,
  limit = 20,
): Promise<Company[]> {
  const supabase = createClient()

  if (!query.trim()) {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .eq('is_active', true)
      .order('job_count', { ascending: false })
      .limit(limit)
    return (data ?? []) as Company[]
  }

  // Try full text search, fall back to ilike
  const { data, error } = await (supabase
    .from('companies')
    .select('*')
    .eq('is_active', true)
    .textSearch('search_vector', query.trim(), { type: 'websearch' })
    .order('job_count', { ascending: false })
    .limit(limit) as any)

  if (error) {
    const { data: fb } = await supabase
      .from('companies')
      .select('*')
      .eq('is_active', true)
      .ilike('name', `%${query.trim()}%`)
      .order('job_count', { ascending: false })
      .limit(limit)
    return (fb ?? []) as Company[]
  }

  return (data ?? []) as Company[]
}

export async function getSearchPreview(
  query: string,
): Promise<{ jobs: JobWithCompany[]; companies: Company[] }> {
  if (!query.trim()) return { jobs: [], companies: [] }

  const [jobsResult, companies] = await Promise.all([
    searchJobs(query, {}, 3, 0),
    searchCompanies(query, 2),
  ])

  return { jobs: jobsResult.jobs, companies }
}
