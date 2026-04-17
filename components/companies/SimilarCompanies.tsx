'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import SponsorshipScore from '@/components/international/SponsorshipScore'
import type { Company } from '@/types'

interface SimilarCompaniesProps {
  companyId: string
  industry: string | null
  limit?: number
}

export default function SimilarCompanies({ companyId, industry, limit = 3 }: SimilarCompaniesProps) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const supabase = createClient()
      let query = supabase
        .from('companies')
        .select('*')
        .eq('is_active', true)
        .neq('id', companyId)
        .order('sponsorship_confidence', { ascending: false })
        .limit(limit)

      if (industry) query = query.eq('industry', industry)

      const { data } = await query
      setCompanies((data as Company[]) ?? [])
      setIsLoading(false)
    }

    void fetch()
  }, [companyId, industry, limit])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: limit }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-gray-100" />
        ))}
      </div>
    )
  }

  if (companies.length === 0) return null

  return (
    <div className="space-y-3">
      {companies.map((company) => (
        <Link
          key={company.id}
          href={`/dashboard/companies/${company.id}`}
          className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 transition hover:border-[#BAE6FD] hover:bg-[#F7FBFF]"
        >
          {company.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logo_url}
              alt={company.name}
              className="h-10 w-10 flex-shrink-0 rounded-xl border border-gray-100 object-contain p-0.5"
            />
          ) : (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#E0F2FE] text-sm font-bold text-[#0C4A6E]">
              {company.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">{company.name}</p>
            <p className="truncate text-xs text-gray-400">{company.industry ?? 'Technology'}</p>
          </div>
          <SponsorshipScore score={company.sponsorship_confidence} size="sm" />
        </Link>
      ))}
    </div>
  )
}
