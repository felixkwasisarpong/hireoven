'use client'

import Link from 'next/link'
import { Bookmark } from 'lucide-react'
import CompanyLogo from '@/components/ui/CompanyLogo'
import type { Company, CompanySize } from '@/types'

interface CompanyCardProps {
  company: Company
  newJobsToday?: number
  isWatching: boolean
  onWatch: (id: string) => void
  onUnwatch: (id: string) => void
}

const SIZE_DOTS: Record<CompanySize, number> = {
  startup:    1,
  small:      2,
  medium:     3,
  large:      4,
  enterprise: 5,
}

function SizeDots({ size }: { size: CompanySize | null }) {
  if (!size) return null
  const filled = SIZE_DOTS[size] ?? 0
  return (
    <span className="flex items-center gap-0.5" title={size}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < filled ? 'bg-[#FF5C18]' : 'bg-gray-200'}`}
        />
      ))}
    </span>
  )
}

export default function CompanyCard({ company, newJobsToday, isWatching, onWatch, onUnwatch }: CompanyCardProps) {
  const confidence = Math.max(0, Math.min(100, company.sponsorship_confidence))
  const confidenceColor =
    confidence >= 80 ? 'bg-emerald-500' :
    confidence >= 60 ? 'bg-[#FF5C18]' :
    confidence >= 40 ? 'bg-amber-400' :
    'bg-gray-300'

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/95 shadow-[0_10px_26px_rgba(15,23,42,0.04)] transition duration-200 hover:border-slate-300 hover:shadow-[0_16px_30px_rgba(15,23,42,0.06)]">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); isWatching ? onUnwatch(company.id) : onWatch(company.id) }}
        className={`absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-2xl border transition ${
          isWatching
            ? 'border-[#FF5C18]/25 bg-[#FFF1E8] text-[#FF5C18] shadow-[0_10px_24px_rgba(255,92,24,0.12)]'
            : 'border-slate-200 bg-white/95 text-slate-400 shadow-[0_6px_18px_rgba(15,23,42,0.03)] hover:border-[#FF5C18] hover:text-[#FF5C18]'
        }`}
        aria-label={isWatching ? 'Unwatch company' : 'Watch company'}
      >
        <Bookmark className="h-3.5 w-3.5" fill={isWatching ? 'currentColor' : 'none'} />
      </button>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3 pr-10">
          <CompanyLogo
            companyName={company.name}
            domain={company.domain}
            logoUrl={company.logo_url}
            className="h-[54px] w-[54px] rounded-[18px] border border-slate-200/80 bg-white object-contain p-1.5 shadow-[0_6px_18px_rgba(15,23,42,0.035)]"
          />
          <div className="min-w-0">
            <p className="leading-tight font-semibold text-slate-950">{company.name}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {company.industry && (
                <span className="rounded-full border border-slate-200/80 bg-slate-100/80 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {company.industry}
                </span>
              )}
              <SizeDots size={company.size} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
          <div>
            <p className={company.job_count > 0 ? 'text-sm font-semibold text-[#FF5C18]' : 'text-sm font-medium text-slate-400'}>
              {company.job_count > 0 ? `${company.job_count.toLocaleString()} open roles` : 'No open roles'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              ATS: {company.ats_type ? company.ats_type.charAt(0).toUpperCase() + company.ats_type.slice(1) : 'Unknown'}
            </p>
          </div>
          {(newJobsToday ?? 0) > 0 && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              +{newJobsToday} today
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-slate-200/75 px-5 py-4" title={`${confidence}% sponsorship confidence based on USCIS data and job description analysis`}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Sponsorship confidence
          </p>
          <p className="text-sm font-semibold text-slate-900">{confidence}%</p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${confidenceColor}`}
            style={{ width: `${confidence}%` }}
          />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {company.sponsors_h1b ? 'Known sponsorship signal' : 'Derived from prior hiring data'}
          </p>
          <Link
            href={`/dashboard/companies/${company.id}`}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {company.job_count > 0 ? `View ${company.job_count.toLocaleString()} jobs` : 'View company'}
          </Link>
        </div>
      </div>
    </div>
  )
}
