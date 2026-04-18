'use client'

import { Globe2 } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { useWatchlist } from '@/lib/hooks/useWatchlist'
import type { Company } from '@/types'

interface CompanyHeaderProps {
  company: Company
  showWatchButton?: boolean
  newJobsThisWeek?: number
}

export default function CompanyHeader({ company, showWatchButton = true, newJobsThisWeek }: CompanyHeaderProps) {
  const { user } = useAuth()
  const { addCompany, removeCompany, isWatching } = useWatchlist(user?.id)
  const watching = isWatching(company.id)
  const confidence = Math.max(0, Math.min(100, company.sponsorship_confidence))

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-start gap-5">
        {company.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logo_url}
            alt={company.name}
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement
              el.style.display = 'none'
              const fb = el.nextSibling as HTMLElement
              if (fb) fb.style.display = 'flex'
            }}
            className="h-20 w-20 flex-shrink-0 rounded-2xl border border-gray-100 object-contain p-1.5"
          />
        ) : null}
        <div
          className={`${company.logo_url ? 'hidden' : 'flex'} h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl bg-[#FFF1E8] text-2xl font-bold text-[#062246]`}
        >
          {company.name.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">{company.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {[company.industry, company.size].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {company.sponsors_h1b && (
              <span className="rounded-full border border-[#FFD2B8] bg-[#FFF7F2] px-3 py-1 text-xs font-semibold text-[#9A3412]">
                Sponsors H-1B
              </span>
            )}
            {company.ats_type && (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600">
                {company.ats_type.charAt(0).toUpperCase() + company.ats_type.slice(1)}
              </span>
            )}
            {company.careers_url && (
              <a
                href={company.careers_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-[#FF5C18] hover:text-[#FF5C18]"
              >
                <Globe2 className="h-3.5 w-3.5" />
                Careers page
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:items-end">
        {showWatchButton && (
          <button
            type="button"
            onClick={() => void (watching ? removeCompany(company.id) : addCompany(company.id))}
            className={`rounded-2xl px-5 py-2.5 text-sm font-semibold transition ${
              watching
                ? 'border border-[#FFD2B8] bg-[#FFF7F2] text-[#062246] hover:bg-[#FFD9C2]'
                : 'bg-[#FF5C18] text-white hover:bg-[#E14F0E]'
            }`}
          >
            {watching ? 'Watching' : 'Watch company'}
          </button>
        )}

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-2xl bg-gray-50 p-3 text-center border border-gray-100">
            <p className="text-xl font-bold tabular-nums text-gray-900">{company.job_count.toLocaleString()}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">open roles</p>
          </div>
          {newJobsThisWeek !== undefined && (
            <div className="rounded-2xl bg-gray-50 p-3 text-center border border-gray-100">
              <p className="text-xl font-bold tabular-nums text-gray-900">{newJobsThisWeek.toLocaleString()}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">new this week</p>
            </div>
          )}
          <div className="rounded-2xl bg-gray-50 p-3 text-center border border-gray-100">
            <p className="text-xl font-bold tabular-nums text-gray-900">{confidence}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">sponsor score</p>
          </div>
          <div className="rounded-2xl bg-gray-50 p-3 text-center border border-gray-100">
            <p className="text-xl font-bold tabular-nums text-gray-900">{company.h1b_sponsor_count_1yr.toLocaleString()}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">H-1B (1yr)</p>
          </div>
        </div>
      </div>
    </div>
  )
}
