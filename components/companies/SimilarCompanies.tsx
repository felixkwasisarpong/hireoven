'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import CompanyLogo from '@/components/ui/CompanyLogo'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

interface SimilarCompaniesProps {
  companyId: string
  industry: string | null
  limit?: number
}

function ConfBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  const color =
    pct >= 80 ? 'bg-emerald-500' :
    pct >= 60 ? 'bg-[#FF5C18]' :
    pct >= 40 ? 'bg-amber-400' :
    'bg-gray-300'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-[11px] font-semibold tabular-nums text-gray-500">{pct}%</span>
    </div>
  )
}

export default function SimilarCompanies({ companyId, industry, limit = 4 }: SimilarCompaniesProps) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const params = new URLSearchParams()
      params.set('limit', String(limit + 1))
      params.set('sort', 'sponsorship_confidence')
      if (industry) params.set('industry', industry)

      const res = await fetch(`/api/companies?${params}`)
      if (!res.ok) { setIsLoading(false); return }

      const { companies: rows } = (await res.json()) as { companies: Company[] }
      setCompanies((rows ?? []).filter((c) => c.id !== companyId).slice(0, limit))
      setIsLoading(false)
    }
    void load()
  }, [companyId, industry, limit])

  if (isLoading) {
    return (
      <div className="divide-y divide-gray-50">
        {Array.from({ length: limit }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-3.5">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-gray-100 flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-36 animate-pulse rounded-full bg-gray-100" />
              <div className="h-2.5 w-24 animate-pulse rounded-full bg-gray-100" />
            </div>
            <div className="h-3 w-20 animate-pulse rounded-full bg-gray-100" />
          </div>
        ))}
      </div>
    )
  }

  if (companies.length === 0) return null

  return (
    <div className="divide-y divide-gray-50">
      {companies.map((company) => (
        <Link
          key={company.id}
          href={`/dashboard/companies/${company.id}`}
          className="group flex items-center gap-3 py-3.5 transition-colors hover:bg-orange-50/20"
        >
          <CompanyLogo
            companyName={company.name}
            domain={company.domain}
            logoUrl={company.logo_url}
            className="h-9 w-9 flex-shrink-0 rounded-xl border border-gray-100 bg-white object-contain p-0.5"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900 transition-colors group-hover:text-[#FF5C18]">
              {company.name}
            </p>
            <p className="truncate text-[11px] text-gray-400">
              {company.industry ?? 'Technology'}
              {company.size ? ` · ${company.size}` : ''}
            </p>
          </div>
          <ConfBar score={company.sponsorship_confidence} />
          <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition group-hover:text-[#FF5C18]" />
        </Link>
      ))}
    </div>
  )
}
