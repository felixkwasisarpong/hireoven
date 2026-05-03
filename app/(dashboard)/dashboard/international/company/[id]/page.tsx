"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Globe2 } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { SponsorshipTruthScore } from "@/components/employers/SponsorshipTruthScore"
import { EmployerHealthScore } from "@/components/employers/EmployerHealthScore"
import JobFeed from "@/components/jobs/JobFeed"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import type { Company, JobFilters } from "@/types"

export default function CompanyProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { addCompany, removeCompany, isWatching } = useWatchlist(user?.id)
  const { primaryResume } = useResumeContext()

  const [company, setCompany] = useState<Company | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const feedFilters: JobFilters = { sort: "freshest", company_ids: [id] }

  useEffect(() => {
    fetch(`/api/companies/${encodeURIComponent(id)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { company: Company | null } | null) => {
        setCompany(d?.company ?? null)
        setIsLoading(false)
      })
      .catch(() => setIsLoading(false))
  }, [id])

  const watching = isWatching(id)

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 h-4 w-24 animate-pulse rounded bg-slate-200" />
          <div className="space-y-6">
            <div className="h-24 animate-pulse rounded bg-slate-200" />
            <div className="h-px bg-slate-200" />
            <div className="h-96 animate-pulse rounded bg-slate-200" />
          </div>
        </div>
      </main>
    )
  }

  if (!company) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-base font-semibold text-slate-900">Company not found</p>
          <Link
            href="/dashboard/international"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to International Hub
          </Link>
        </div>
      </main>
    )
  }

  const meta = [company.industry, company.size].filter(Boolean).join(" · ")

  // Only use logo_url when it's an absolute URL — local paths like /company-logos/*.svg are broken
  const resolvedLogoUrl = company.logo_url?.startsWith("http") ? company.logo_url : null

  return (
    <main className="app-page bg-white">
      <div className="app-shell px-4 py-8 sm:px-6 lg:px-10">

        {/* ── Back link ── */}
        <Link
          href="/dashboard/international"
          className="mb-8 inline-flex items-center gap-1.5 text-[13px] text-slate-400 transition hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          International Hub
        </Link>

        {/* ── Company header ── */}
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-4 min-w-0">
            <CompanyLogo
              companyName={company.name}
              domain={company.domain}
              logoUrl={resolvedLogoUrl}
              priority
              className="h-14 w-14 flex-shrink-0 rounded-xl"
            />
            <div className="min-w-0">
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900">
                {company.name}
              </h1>
              {meta && (
                <p className="mt-0.5 text-[13px] text-slate-500">{meta}</p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {company.sponsors_h1b && (
                  <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
                    Sponsors H-1B
                  </span>
                )}
                {company.careers_url && (
                  <a
                    href={company.careers_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] text-slate-500 transition hover:text-slate-800"
                  >
                    <Globe2 className="h-3.5 w-3.5" />
                    Careers page
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-shrink-0 flex-col items-end gap-3">
            <button
              type="button"
              onClick={() => void (watching ? removeCompany(id) : addCompany(id))}
              className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${
                watching
                  ? "bg-sky-50 text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100"
                  : "bg-slate-900 text-white hover:bg-slate-700"
              }`}
            >
              {watching ? "Watching" : "Watch"}
            </button>
          </div>
        </div>

        {/* ── Quick stats — flat row, no boxes ── */}
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
          {[
            { label: "H-1B petitions (1yr)", value: company.h1b_sponsor_count_1yr.toLocaleString() },
            { label: "H-1B petitions (3yr)", value: company.h1b_sponsor_count_3yr.toLocaleString() },
            { label: "Open roles",            value: company.job_count.toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[22px] font-bold tabular-nums leading-none text-slate-900">{value}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Sponsorship Truth Score ── */}
        <div className="mt-8 border-t border-slate-100 pt-8">
          <SponsorshipTruthScore companyId={id} companyName={company.name} />
        </div>

        {/* ── Employer Financial Health Score ── */}
        <div className="mt-8 border-t border-slate-100 pt-8">
          <EmployerHealthScore companyId={id} companyName={company.name} />
        </div>

        {/* ── Open roles ── */}
        <div className="mt-8 border-t border-slate-100 pt-8">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
            Open Roles
          </p>
          <h2 className="mb-5 text-[17px] font-semibold text-slate-900">
            Current openings at {company.name}
          </h2>
          <JobFeed
            filters={feedFilters}
            searchQuery=""
            defaultView="list"
            hasPrimaryResume={Boolean(primaryResume?.id)}
          />
        </div>

      </div>
    </main>
  )
}
