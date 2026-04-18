'use client'
import Link from 'next/link'
import { Briefcase, Plus, Check } from 'lucide-react'
import SponsorshipScore from './SponsorshipScore'
import type { Company } from '@/types'

interface CompanyH1BCardProps {
  company: Company
  openRoles?: number
  isWatching: boolean
  onWatch: (id: string) => void
  onUnwatch: (id: string) => void
}

export default function CompanyH1BCard({ company, openRoles, isWatching, onWatch, onUnwatch }: CompanyH1BCardProps) {
  const roles = openRoles ?? company.job_count

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col gap-4 hover:shadow-sm transition-shadow">
      {/* Header */}
      <div className="flex items-start gap-3">
        {company.logo_url ? (
          <img
            src={company.logo_url}
            alt={company.name}
            className="w-10 h-10 rounded-xl border border-gray-100 object-contain flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-[#FFF1E8] flex items-center justify-center text-[#062246] font-semibold text-sm flex-shrink-0">
            {company.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate">{company.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {[company.industry, company.size].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {/* H1B petition counts */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-gray-900 tabular-nums">
            {company.h1b_sponsor_count_1yr.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">petitions last year</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-gray-900 tabular-nums">
            {company.h1b_sponsor_count_3yr.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">petitions (3 yrs)</p>
        </div>
      </div>

      {/* Sponsorship score */}
      <SponsorshipScore score={company.sponsorship_confidence} size="lg" />

      {/* Open roles */}
      {roles > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Briefcase className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{roles.toLocaleString()} open role{roles !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        <Link
          href={`/dashboard/international/company/${company.id}`}
          className="flex-1 py-2 text-center text-xs font-semibold text-[#FF5C18] border border-[#FF5C18] rounded-xl hover:bg-[#FFF1E8] transition-colors"
        >
          View jobs
        </Link>
        <button
          onClick={() => (isWatching ? onUnwatch(company.id) : onWatch(company.id))}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-colors ${
            isWatching
              ? 'bg-[#FFF1E8] text-[#FF5C18] border-[#FF5C18]/30'
              : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-[#FF5C18] hover:text-[#FF5C18]'
          }`}
        >
          {isWatching ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {isWatching ? 'Watching' : 'Watch'}
        </button>
      </div>
    </div>
  )
}
