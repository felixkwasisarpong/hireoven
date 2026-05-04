'use client'

import Link from 'next/link'
import { ArrowUpRight, BookmarkCheck, Bookmark } from 'lucide-react'
import SponsorshipScore from './SponsorshipScore'
import CompanyLogo from '@/components/ui/CompanyLogo'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

interface CompanyH1BCardProps {
  company: Company
  openRoles?: number
  isWatching: boolean
  onWatch: (id: string) => void
  onUnwatch: (id: string) => void
}

export default function CompanyH1BCard({
  company,
  openRoles,
  isWatching,
  onWatch,
  onUnwatch,
}: CompanyH1BCardProps) {
  const roles = openRoles ?? company.job_count

  return (
    <div className="group flex flex-col rounded-2xl border border-slate-200/70 bg-white p-4 transition duration-200 hover:border-indigo-200/80 hover:shadow-[0_12px_32px_rgba(99,102,241,0.08)]">
      {/* Header: logo + name + watch */}
      <div className="flex items-start gap-3">
        <CompanyLogo
          companyName={company.name}
          domain={company.domain}
          logoUrl={company.logo_url}
          className="h-10 w-10 flex-shrink-0 rounded-xl border border-slate-100 bg-white object-contain p-1 shadow-[0_3px_8px_rgba(15,23,42,0.04)]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 transition-colors group-hover:text-indigo-700">
            {company.name}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">
            {[company.industry, company.size].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => isWatching ? onUnwatch(company.id) : onWatch(company.id)}
          aria-label={isWatching ? 'Unwatch' : 'Watch'}
          className={cn(
            'flex-shrink-0 rounded-lg p-1.5 transition',
            isWatching
              ? 'text-[#FF5C18]'
              : 'text-slate-300 hover:text-indigo-600'
          )}
        >
          {isWatching
            ? <BookmarkCheck className="h-4 w-4" />
            : <Bookmark className="h-4 w-4" />}
        </button>
      </div>

      {/* Petition stats inline */}
      <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4">
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            This year
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-slate-950">
            {company.h1b_sponsor_count_1yr.toLocaleString()}
          </p>
        </div>
        <div className="h-8 w-px bg-slate-100" />
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            3 years
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-slate-950">
            {company.h1b_sponsor_count_3yr.toLocaleString()}
          </p>
        </div>
        <div className="h-8 w-px bg-slate-100" />
        <div className="flex-1 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Roles
          </p>
          <p className={cn(
            'mt-1 text-xl font-bold tabular-nums',
            roles > 0 ? 'text-indigo-600' : 'text-slate-300'
          )}>
            {roles > 0 ? roles.toLocaleString() : '—'}
          </p>
        </div>
      </div>

      {/* Score */}
      <div className="mt-3">
        <SponsorshipScore score={company.sponsorship_confidence} size="lg" />
      </div>

      {/* CTA */}
      <Link
        href={`/dashboard/international/company/${company.id}`}
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50/60 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
      >
        View jobs & intel
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
