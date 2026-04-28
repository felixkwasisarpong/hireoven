"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"
import CompanyCard from "@/components/companies/CompanyCard"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"
import JobCard from "@/components/jobs/JobCard"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { searchCompanies, searchJobs } from "@/lib/search"
import type { Company, JobWithCompany } from "@/types"

const TRENDING = ["Software Engineer", "Product Manager", "Data Scientist", "UX Designer", "Marketing Manager"]

function highlight(text: string, query: string) {
  if (!query.trim()) return text
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const parts = text.split(new RegExp(`(${escaped})`, "gi"))
  return parts.map((part, i) =>
    new RegExp(escaped, "i").test(part)
      ? `<mark class="bg-yellow-100 text-yellow-900 rounded px-0.5">${part}</mark>`
      : part
  ).join("")
}

export default function SearchPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawQ = searchParams.get("q") ?? ""
  const { user } = useAuth()
  const { addCompany, removeCompany, isWatching } = useWatchlist(user?.id)

  const [inputVal, setInputVal] = useState(rawQ)
  const [jobs, setJobs] = useState<JobWithCompany[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [jobTotal, setJobTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setInputVal(rawQ) }, [rawQ])

  useEffect(() => {
    if (!rawQ.trim()) { setJobs([]); setCompanies([]); setJobTotal(0); return }
    setIsLoading(true)
    Promise.all([
      searchJobs(rawQ, {}, 20, 0),
      searchCompanies(rawQ, 10),
    ]).then(([jobsResult, companiesResult]) => {
      setJobs(jobsResult.jobs)
      setJobTotal(jobsResult.total)
      setCompanies(companiesResult)
      setIsLoading(false)
    })
  }, [rawQ])

  function submit(q: string) {
    if (!q.trim()) return
    router.push(`/dashboard/search?q=${encodeURIComponent(q.trim())}`)
  }

  const hasResults = jobs.length > 0 || companies.length > 0
  const bothMatch = jobs.length > 0 && companies.length > 0

  return (
    <main className="app-page">
      <div className="app-shell max-w-7xl space-y-6">
        <DashboardPageHeader
          kicker="Search"
          title="Find jobs and companies from one command bar"
          description="Search across active roles, tracked companies, and sponsorship signals without leaving the dashboard."
          backHref="/dashboard"
          backLabel="Back to dashboard"
        />

        {/* Search bar */}
        <section className="surface-panel rounded-lg p-4 sm:p-5">
          <form
            onSubmit={(e) => { e.preventDefault(); submit(inputVal) }}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:gap-3"
          >
            <Search className="h-5 w-5 flex-shrink-0 text-primary" />
            <input
              ref={inputRef}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Search jobs and companies…"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-base text-strong outline-none placeholder:text-muted-foreground"
            />
            {inputVal && (
              <button
                type="button"
                onClick={() => { setInputVal(""); inputRef.current?.focus() }}
                className="flex-shrink-0 rounded-md text-muted-foreground transition-colors hover:bg-surface-alt hover:text-strong"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover sm:shrink-0"
            >
              Search
            </button>
          </form>

            {rawQ ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {isLoading ? (
                "Searching…"
              ) : (
                <>
                  <span className="font-semibold text-strong">{jobTotal.toLocaleString()} jobs</span>{" "}
                  and{" "}
                  <span className="font-semibold text-strong">{companies.length.toLocaleString()} companies</span>{" "}
                  match &ldquo;{rawQ}&rdquo;
                </>
              )}
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Trending searches</p>
              <div className="flex flex-wrap gap-2">
                {TRENDING.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => submit(term)}
                    className="chip-control"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Loading skeletons */}
        {isLoading && (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="surface-panel h-36 animate-pulse rounded-lg" />
              ))}
            </div>
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="surface-panel h-52 animate-pulse rounded-lg" />
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {!isLoading && rawQ && !hasResults && (
          <div className="empty-state">
            <p className="text-lg font-semibold text-strong">No results for &ldquo;{rawQ}&rdquo;</p>
            <p className="mt-2 text-sm text-muted-foreground">Try a different search term or browse companies directly.</p>
            <Link
              href="/dashboard/companies"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Browse all companies
            </Link>
          </div>
        )}

        {/* Results: dual column if both match */}
        {!isLoading && hasResults && (
          <div className={bothMatch ? "grid gap-6 lg:grid-cols-[1fr_360px]" : ""}>
            {/* Jobs column */}
            {jobs.length > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                    Jobs · {jobTotal.toLocaleString()} results
                  </p>
                  {jobTotal > jobs.length && (
                    <Link
                      href={`/dashboard?q=${encodeURIComponent(rawQ)}`}
                      className="text-xs font-medium text-primary transition-colors hover:text-primary-hover"
                    >
                      View all {jobTotal.toLocaleString()} →
                    </Link>
                  )}
                </div>
                <div className="space-y-4">
                  {jobs.map((job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>
              </div>
            )}

            {/* Companies column */}
            {companies.length > 0 && (
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                  Companies · {companies.length} results
                </p>
                <div className={bothMatch ? "space-y-3" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
                  {bothMatch ? (
                    companies.map((company) => (
                      <Link
                        key={company.id}
                        href={`/dashboard/companies/${company.id}`}
                        className="surface-card-subtle flex items-center gap-3 rounded-md p-3 transition-colors hover:border-brand-tint-strong hover:bg-brand-tint"
                      >
                        {company.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={company.logo_url} alt={company.name} className="h-10 w-10 flex-shrink-0 rounded-xl border border-gray-100 object-contain bg-white p-0.5" />
                        ) : (
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#FFF1E8] text-sm font-bold text-[#ea580c]">
                            {company.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900"
                             dangerouslySetInnerHTML={{ __html: highlight(company.name, rawQ) }}
                          />
                          <p className="truncate text-xs text-gray-400">
                            {company.industry ?? "Company"} · {company.job_count} open roles
                          </p>
                        </div>
                      </Link>
                    ))
                  ) : (
                    companies.map((company) => (
                      <CompanyCard
                        key={company.id}
                        company={company}
                        isWatching={isWatching(company.id)}
                        onWatch={(id) => void addCompany(id)}
                        onUnwatch={(id) => void removeCompany(id)}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
