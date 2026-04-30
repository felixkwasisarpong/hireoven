'use client'

import { Bookmark, BookmarkCheck, Globe2 } from 'lucide-react'
import CompanyLogo from '@/components/ui/CompanyLogo'
import { useAuth } from '@/lib/hooks/useAuth'
import { useWatchlist } from '@/lib/hooks/useWatchlist'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

interface CompanyHeaderProps {
  company: Company
  showWatchButton?: boolean
  newJobsThisWeek?: number
}

export default function CompanyHeader({
  company,
  showWatchButton = true,
  newJobsThisWeek,
}: CompanyHeaderProps) {
  const { user } = useAuth()
  const { addCompany, removeCompany, isWatching } = useWatchlist(user?.id)
  const watching = isWatching(company.id)
  const confidence = Math.max(0, Math.min(100, company.sponsorship_confidence))

  return (
    <div>
      {/* Name row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <CompanyLogo
            companyName={company.name}
            domain={company.domain}
            logoUrl={company.logo_url}
            className="h-14 w-14 flex-shrink-0 rounded-2xl border border-gray-100 bg-white object-contain p-1.5 shadow-[0_4px_14px_rgba(15,23,42,0.06)]"
          />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
              {company.name}
            </h1>
            {(company.industry || company.size) && (
              <p className="mt-0.5 text-sm text-gray-400">
                {[company.industry, company.size].filter(Boolean).join(' · ')}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {company.sponsors_h1b && (
                <span className="rounded-full border border-[#FFD2B8] bg-[#FFF7F2] px-2.5 py-0.5 text-[11px] font-semibold text-[#9A3412]">
                  Sponsors H-1B
                </span>
              )}
              {company.ats_type && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 capitalize">
                  {company.ats_type}
                </span>
              )}
              {company.careers_url && (
                <a
                  href={company.careers_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] font-medium text-gray-500 transition hover:border-[#FF5C18] hover:text-[#FF5C18]"
                >
                  <Globe2 className="h-3 w-3" />
                  Careers
                </a>
              )}
            </div>
          </div>
        </div>

        {showWatchButton && (
          <button
            type="button"
            onClick={() => void (watching ? removeCompany(company.id) : addCompany(company.id))}
            className={cn(
              'flex-shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
              watching
                ? 'border border-[#FFD2B8] bg-[#FFF7F2] text-[#ea580c] hover:bg-[#FFD9C2]'
                : 'bg-[#FF5C18] text-white shadow-[0_4px_14px_rgba(255,92,24,0.28)] hover:bg-[#E14F0E]'
            )}
          >
            {watching ? (
              <>
                <BookmarkCheck className="h-4 w-4" />
                Watching
              </>
            ) : (
              <>
                <Bookmark className="h-4 w-4" />
                Watch
              </>
            )}
          </button>
        )}
      </div>

      {/* Inline stats strip */}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-100 pt-4">
        <div className="flex items-baseline gap-1.5">
          <span className={cn(
            "text-xl font-bold tabular-nums",
            company.job_count > 0 ? "text-[#FF5C18]" : "text-gray-400"
          )}>
            {company.job_count.toLocaleString()}
          </span>
          <span className="text-xs text-gray-400">open roles</span>
        </div>

        {newJobsThisWeek !== undefined && newJobsThisWeek > 0 && (
          <>
            <span className="h-3 w-px bg-gray-200" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold tabular-nums text-emerald-600">
                +{newJobsThisWeek.toLocaleString()}
              </span>
              <span className="text-xs text-gray-400">this week</span>
            </div>
          </>
        )}

        <span className="h-3 w-px bg-gray-200" />
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tabular-nums text-gray-900">{confidence}</span>
          <span className="text-xs text-gray-400">sponsor score</span>
        </div>

        {company.h1b_sponsor_count_1yr > 0 && (
          <>
            <span className="h-3 w-px bg-gray-200" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold tabular-nums text-gray-900">
                {company.h1b_sponsor_count_1yr.toLocaleString()}
              </span>
              <span className="text-xs text-gray-400">H-1B petitions (1yr)</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
