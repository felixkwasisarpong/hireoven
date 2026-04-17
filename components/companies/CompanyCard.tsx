'use client'

import Link from 'next/link'
import { Bookmark } from 'lucide-react'
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

const INITIAL_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
]

function getInitialColor(name: string) {
  const idx = name.charCodeAt(0) % INITIAL_COLORS.length
  return INITIAL_COLORS[idx]
}

function SizeDots({ size }: { size: CompanySize | null }) {
  if (!size) return null
  const filled = SIZE_DOTS[size] ?? 0
  return (
    <span className="flex items-center gap-0.5" title={size}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < filled ? 'bg-[#0369A1]' : 'bg-gray-200'}`}
        />
      ))}
    </span>
  )
}

export default function CompanyCard({ company, newJobsToday, isWatching, onWatch, onUnwatch }: CompanyCardProps) {
  const confidence = Math.max(0, Math.min(100, company.sponsorship_confidence))
  const confidenceColor =
    confidence >= 80 ? 'bg-emerald-500' :
    confidence >= 60 ? 'bg-[#0369A1]' :
    confidence >= 40 ? 'bg-amber-400' :
    'bg-gray-300'

  return (
    <div className="group relative flex flex-col rounded-2xl border border-gray-200 bg-white overflow-hidden hover:shadow-[0_12px_32px_rgba(14,30,70,0.09)] hover:-translate-y-0.5 transition duration-200">
      {/* Watch button */}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); isWatching ? onUnwatch(company.id) : onWatch(company.id) }}
        className={`absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-xl border transition ${
          isWatching
            ? 'border-[#0369A1] bg-[#E0F2FE] text-[#0369A1]'
            : 'border-gray-200 bg-white text-gray-400 hover:border-[#0369A1] hover:text-[#0369A1]'
        }`}
        aria-label={isWatching ? 'Unwatch company' : 'Watch company'}
      >
        <Bookmark className="h-3.5 w-3.5" fill={isWatching ? 'currentColor' : 'none'} />
      </button>

      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* Logo + name */}
        <div className="flex items-start gap-3 pr-8">
          {company.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logo_url}
              alt={company.name}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex' }}
              className="h-[60px] w-[60px] flex-shrink-0 rounded-2xl border border-gray-100 object-contain p-1"
            />
          ) : null}
          <div
            className={`${company.logo_url ? 'hidden' : 'flex'} h-[60px] w-[60px] flex-shrink-0 items-center justify-center rounded-2xl text-xl font-bold ${getInitialColor(company.name)}`}
          >
            {company.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 leading-tight">{company.name}</p>
            <div className="mt-1.5 flex items-center gap-2">
              {company.industry && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  {company.industry}
                </span>
              )}
              <SizeDots size={company.size} />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-sm">
          <span className={company.job_count > 0 ? 'font-semibold text-[#0369A1]' : 'text-gray-400'}>
            {company.job_count > 0 ? `${company.job_count.toLocaleString()} open roles` : 'No open roles'}
          </span>
          {(newJobsToday ?? 0) > 0 && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
              +{newJobsToday} today
            </span>
          )}
        </div>
      </div>

      {/* Sponsorship confidence bar */}
      <div
        className="px-4 pb-4"
        title={`${confidence}% sponsorship confidence based on USCIS data and job description analysis`}
      >
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all ${confidenceColor}`}
            style={{ width: `${confidence}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-gray-400">{confidence}% sponsorship confidence</p>
      </div>

      {/* Hover overlay */}
      {company.job_count > 0 && (
        <Link
          href={`/dashboard/companies/${company.id}`}
          className="absolute inset-0 flex items-end justify-center pb-5 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-white/90 via-white/40 to-transparent rounded-2xl"
        >
          <span className="rounded-2xl bg-[#0369A1] px-5 py-2.5 text-sm font-semibold text-white shadow-lg">
            View {company.job_count.toLocaleString()} job{company.job_count !== 1 ? 's' : ''}
          </span>
        </Link>
      )}
      {company.job_count === 0 && (
        <Link href={`/dashboard/companies/${company.id}`} className="absolute inset-0 rounded-2xl" aria-label={company.name} />
      )}
    </div>
  )
}
