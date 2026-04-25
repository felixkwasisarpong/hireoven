'use client'
import Link from 'next/link'
import { ArrowUpRight, Briefcase, Check, Eye, ShieldCheck, TrendingUp } from 'lucide-react'
import SponsorshipScore from './SponsorshipScore'
import CompanyLogo from '@/components/ui/CompanyLogo'
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
    <div className="group rounded-lg border border-slate-100 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      {/* Header */}
      <div className="flex items-start gap-3">
        <CompanyLogo
          companyName={company.name}
          domain={company.domain}
          logoUrl={company.logo_url}
          className="h-11 w-11 rounded-lg border border-slate-100 bg-white"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-950">{company.name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {[company.industry, company.size].filter(Boolean).join(' · ')}
          </p>
        </div>
        {company.sponsors_h1b && (
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>

      {/* H1B petition counts */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <TrendingUp className="h-3.5 w-3.5 text-indigo-500" />
            Last year
          </div>
          <p className="text-xl font-bold tabular-nums text-slate-950">
            {company.h1b_sponsor_count_1yr.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg bg-orange-50/70 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-orange-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            3 years
          </div>
          <p className="text-xl font-bold tabular-nums text-slate-950">
            {company.h1b_sponsor_count_3yr.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Sponsorship score */}
      <div className="mt-4">
        <SponsorshipScore score={company.sponsorship_confidence} size="lg" />
      </div>

      {/* Open roles */}
      {roles > 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Briefcase className="h-3.5 w-3.5 flex-shrink-0 text-indigo-500" />
          <span>{roles.toLocaleString()} open role{roles !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <Link
          href={`/dashboard/international/company/${company.id}`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/70 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
        >
          View jobs
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        <button
          onClick={() => (isWatching ? onUnwatch(company.id) : onWatch(company.id))}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
            isWatching
              ? 'border-orange-200 bg-orange-50 text-orange-700'
              : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700'
          }`}
        >
          {isWatching ? <Check className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {isWatching ? 'Watching' : 'Watch'}
        </button>
      </div>
    </div>
  )
}
