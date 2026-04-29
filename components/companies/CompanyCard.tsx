'use client'

import Link from 'next/link'
import { Bookmark } from 'lucide-react'
import CompanyLogo from '@/components/ui/CompanyLogo'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

interface CompanyCardProps {
  company: Company
  newJobsToday?: number
  isWatching: boolean
  onWatch: (id: string) => void
  onUnwatch: (id: string) => void
}

export default function CompanyCard({
  company,
  newJobsToday,
  isWatching,
  onWatch,
  onUnwatch,
}: CompanyCardProps) {
  const confidence = Math.max(0, Math.min(100, company.sponsorship_confidence))
  const barColor =
    confidence >= 80 ? 'bg-emerald-500' :
    confidence >= 60 ? 'bg-[#FF5C18]' :
    confidence >= 40 ? 'bg-amber-400' :
    'bg-gray-200'

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white transition duration-200 hover:border-slate-300 hover:shadow-[0_12px_28px_rgba(15,23,42,0.07)]">
      {/* Watch button */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          isWatching ? onUnwatch(company.id) : onWatch(company.id)
        }}
        aria-label={isWatching ? 'Unwatch company' : 'Watch company'}
        className={cn(
          'absolute right-3.5 top-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-xl border transition',
          isWatching
            ? 'border-[#FF5C18]/25 bg-[#FFF1E8] text-[#FF5C18] shadow-[0_4px_12px_rgba(255,92,24,0.1)]'
            : 'border-slate-200 bg-white/90 text-slate-400 hover:border-[#FF5C18]/40 hover:text-[#FF5C18]'
        )}
      >
        <Bookmark className="h-3.5 w-3.5" fill={isWatching ? 'currentColor' : 'none'} />
      </button>

      <Link href={`/dashboard/companies/${company.id}`} className="flex flex-1 flex-col p-4">
        {/* Logo + name */}
        <div className="flex items-center gap-3 pr-9">
          <CompanyLogo
            companyName={company.name}
            domain={company.domain}
            logoUrl={company.logo_url}
            className="h-10 w-10 flex-shrink-0 rounded-xl border border-slate-100 bg-white object-contain p-1 shadow-[0_4px_12px_rgba(15,23,42,0.04)]"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 transition-colors group-hover:text-[#FF5C18]">
              {company.name}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
              {company.industry && (
                <span className="text-[11px] text-slate-400">{company.industry}</span>
              )}
              {company.industry && company.size && (
                <span className="text-slate-300">·</span>
              )}
              {company.size && (
                <span className="text-[11px] capitalize text-slate-400">{company.size}</span>
              )}
            </div>
          </div>
        </div>

        {/* Jobs row */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className={cn(
            'text-sm font-semibold',
            company.job_count > 0 ? 'text-[#FF5C18]' : 'text-slate-400'
          )}>
            {company.job_count > 0
              ? `${company.job_count.toLocaleString()} open roles`
              : 'No open roles'}
          </p>
          {(newJobsToday ?? 0) > 0 && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              +{newJobsToday} today
            </span>
          )}
        </div>
      </Link>

      {/* Confidence footer */}
      <div className="border-t border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Sponsor score
          </p>
          <p className="text-xs font-semibold tabular-nums text-slate-700">{confidence}%</p>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn('h-full rounded-full transition-all duration-500', barColor)}
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>
    </div>
  )
}
