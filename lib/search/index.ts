import type { Company, JobFilters, JobWithCompany } from '@/types'

const PAGE_SIZE = 24

export async function searchJobs(
  query: string,
  filters: JobFilters = {},
  limit = PAGE_SIZE,
  offset = 0,
): Promise<{ jobs: JobWithCompany[]; total: number }> {
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query.trim())
  if (filters.remote) params.set('remote', 'true')
  if (filters.sponsorship) params.set('sponsorship', 'true')
  if (filters.seniority?.length) params.set('seniority', filters.seniority.join(','))
  if (filters.employment_type?.length) params.set('employment_type', filters.employment_type.join(','))
  if (filters.company_ids?.length) params.set('company_id', filters.company_ids[0])
  if (filters.within && filters.within !== 'all') params.set('within', filters.within)
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  const res = await fetch(`/api/jobs?${params}`, { cache: 'no-store' })
  if (!res.ok) return { jobs: [], total: 0 }

  const data = (await res.json()) as { jobs?: JobWithCompany[]; total?: number }
  return { jobs: data.jobs ?? [], total: data.total ?? 0 }
}

export async function searchCompanies(
  query: string,
  limit = 20,
): Promise<Company[]> {
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query.trim())
  params.set('limit', String(limit))
  params.set('sort', 'job_count')

  const res = await fetch(`/api/companies?${params}`, { cache: 'no-store' })
  if (!res.ok) return []

  const data = (await res.json()) as { companies?: Company[] }
  return data.companies ?? []
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
