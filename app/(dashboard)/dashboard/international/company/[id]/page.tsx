"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Globe2 } from "lucide-react"
import SponsorshipScore from "@/components/international/SponsorshipScore"
import JobFeed from "@/components/jobs/JobFeed"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import type { Company, H1BRecord, JobFilters } from "@/types"

type PetitionBar = { year: number; approved: number; denied: number }

export default function CompanyProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { addCompany, removeCompany, isWatching } = useWatchlist(user?.id)

  const [company, setCompany] = useState<Company | null>(null)
  const [records, setRecords] = useState<H1BRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const feedFilters: JobFilters = { sort: "freshest", company_ids: [id] }

  useEffect(() => {
    async function fetchData() {
      const [companyRes, h1bRes] = await Promise.all([
        fetch(`/api/companies/${encodeURIComponent(id)}`),
        fetch(`/api/h1b/records?companyId=${encodeURIComponent(id)}&limit=5`),
      ])

      const companyData = companyRes.ok
        ? ((await companyRes.json()) as { company: Company | null }).company
        : null
      const h1bData = h1bRes.ok
        ? ((await h1bRes.json()) as { records: H1BRecord[] }).records
        : []

      setCompany(companyData)
      setRecords(h1bData)
      setIsLoading(false)
    }

    void fetchData()
  }, [id])

  const watching = isWatching(id)

  const petitionBars: PetitionBar[] = records
    .filter((r) => r.year !== null)
    .map((r) => ({
      year: r.year!,
      approved: r.approved ?? 0,
      denied: r.denied ?? 0,
    }))
    .sort((a, b) => a.year - b.year)

  const maxPetitions = Math.max(
    1,
    ...petitionBars.map((b) => b.approved + b.denied)
  )

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_58%,#F8FAFC_100%)] px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="h-48 animate-pulse rounded-[32px] bg-white/80" />
          <div className="h-64 animate-pulse rounded-[28px] bg-white/80" />
          <div className="h-96 animate-pulse rounded-[28px] bg-white/80" />
        </div>
      </main>
    )
  }

  if (!company) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_58%,#F8FAFC_100%)] px-4 py-6 lg:px-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">Company not found</p>
          <Link
            href="/dashboard/international"
            className="mt-4 inline-flex items-center gap-2 text-sm text-[#0369A1] hover:text-[#0C4A6E]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to International Hub
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_58%,#F8FAFC_100%)] px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* ── Company header ── */}
        <section className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <Link
            href="/dashboard/international"
            className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 transition hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
            International Hub
          </Link>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-5">
              {company.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={company.logo_url}
                  alt={company.name}
                  className="h-16 w-16 rounded-2xl border border-gray-100 object-contain flex-shrink-0"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E0F2FE] text-xl font-bold text-[#0C4A6E] flex-shrink-0">
                  {company.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
                  {company.name}
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  {[company.industry, company.size].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {company.sponsors_h1b && (
                    <span className="rounded-full bg-[#F0F9FF] px-3 py-1 text-xs font-semibold text-[#0C4A6E] border border-[#BAE6FD]">
                      Sponsors H-1B
                    </span>
                  )}
                  {company.careers_url && (
                    <a
                      href={company.careers_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-[#0369A1] hover:text-[#0369A1]"
                    >
                      <Globe2 className="h-3.5 w-3.5" />
                      Careers page
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <button
                type="button"
                onClick={() => void (watching ? removeCompany(id) : addCompany(id))}
                className={`rounded-2xl px-5 py-2.5 text-sm font-semibold transition ${
                  watching
                    ? "bg-[#F0F9FF] text-[#0C4A6E] border border-[#BAE6FD] hover:bg-[#D6EEFF]"
                    : "bg-[#0369A1] text-white hover:bg-[#075985]"
                }`}
              >
                {watching ? "Watching" : "Watch company"}
              </button>
              <div className="w-64">
                <SponsorshipScore score={company.sponsorship_confidence} size="lg" />
              </div>
            </div>
          </div>

          {/* Summary stats */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl bg-[#F8FBFF] p-4 text-center border border-gray-100">
              <p className="text-2xl font-bold tabular-nums text-gray-900">
                {company.h1b_sponsor_count_1yr.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">petitions (1yr)</p>
            </div>
            <div className="rounded-2xl bg-[#F8FBFF] p-4 text-center border border-gray-100">
              <p className="text-2xl font-bold tabular-nums text-gray-900">
                {company.h1b_sponsor_count_3yr.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">petitions (3yr)</p>
            </div>
            <div className="rounded-2xl bg-[#F8FBFF] p-4 text-center border border-gray-100">
              <p className="text-2xl font-bold tabular-nums text-gray-900">
                {company.job_count.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">open roles</p>
            </div>
            <div className="rounded-2xl bg-[#F8FBFF] p-4 text-center border border-gray-100">
              <p className="text-2xl font-bold tabular-nums text-gray-900">
                {company.sponsorship_confidence}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">confidence score</p>
            </div>
          </div>
        </section>

        {/* ── H1B petition history ── */}
        {petitionBars.length > 0 && (
          <section className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              H-1B petition history
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              Approved and denied petitions per year from USCIS data.
            </p>

            <div className="space-y-4">
              {petitionBars.map(({ year, approved, denied }) => {
                const total = approved + denied
                const approvedPct = Math.max(2, Math.round((approved / maxPetitions) * 100))
                const deniedPct = Math.max(0, Math.round((denied / maxPetitions) * 100))
                const rate = total > 0 ? Math.round((approved / total) * 100) : 0
                return (
                  <div key={year} className="flex items-center gap-4">
                    <p className="w-14 flex-shrink-0 text-sm font-medium text-gray-500">
                      {year}
                    </p>
                    <div className="flex flex-1 h-9 gap-1 items-center">
                      <div
                        className="h-full rounded-l-xl bg-[#0369A1]"
                        style={{ width: `${approvedPct}%` }}
                        title={`${approved.toLocaleString()} approved`}
                      />
                      {denied > 0 && (
                        <div
                          className="h-full rounded-r-xl bg-red-300"
                          style={{ width: `${deniedPct}%` }}
                          title={`${denied.toLocaleString()} denied`}
                        />
                      )}
                    </div>
                    <div className="w-28 flex-shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-gray-900">
                        {total.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-400">{rate}% approved</p>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-[#0369A1]" />
                Approved
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-red-300" />
                Denied
              </span>
            </div>
          </section>
        )}

        {/* ── Open roles ── */}
        <section>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-400">
            Open Roles
          </p>
          <div className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">
              Current openings at {company.name}
            </h2>
            <JobFeed filters={feedFilters} searchQuery="" />
          </div>
        </section>

        {/* ── Community placeholder ── */}
        <section className="rounded-[28px] border border-dashed border-gray-200 bg-white/60 p-6">
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-500 mb-1">
              Community insights coming soon
            </p>
            <p className="text-xs text-gray-400">
              Interview experiences, offer data, and timeline reports from people who have gone through the H-1B process here.
            </p>
          </div>
        </section>

      </div>
    </main>
  )
}
