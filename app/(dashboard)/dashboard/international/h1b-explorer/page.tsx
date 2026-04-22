"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Loader2, Search } from "lucide-react"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"
import { createClient } from "@/lib/supabase/client"
import type { EmployerLCAStats, LCARecord } from "@/types"

const PAGE_SIZE = 50

const CASE_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "Certified", label: "Certified" },
  { value: "Denied", label: "Denied" },
  { value: "Withdrawn", label: "Withdrawn" },
  { value: "Certified-Withdrawn", label: "Certified-Withdrawn" },
]

const WAGE_LEVEL_OPTIONS = [
  { value: "", label: "All wage levels" },
  { value: "I", label: "Level I" },
  { value: "II", label: "Level II" },
  { value: "III", label: "Level III" },
  { value: "IV", label: "Level IV" },
]

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR",
]

type TabKey = "records" | "employers"

function formatCurrency(value: number | null) {
  if (value === null || Number.isNaN(value)) return "-"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function statusTone(status: string | null) {
  if (!status) return "text-muted-foreground"
  const lower = status.toLowerCase()
  if (lower.includes("certified")) {
    return lower.includes("withdrawn")
      ? "text-amber-700 bg-amber-50 border-amber-200"
      : "text-emerald-700 bg-emerald-50 border-emerald-200"
  }
  if (lower.includes("denied")) return "text-red-700 bg-red-50 border-red-200"
  if (lower.includes("withdrawn"))
    return "text-gray-600 bg-gray-50 border-gray-200"
  return "text-slate-700 bg-slate-50 border-slate-200"
}

export default function H1BExplorerPage() {
  const [tab, setTab] = useState<TabKey>("records")

  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [fiscalYear, setFiscalYear] = useState("")
  const [state, setState] = useState("")
  const [caseStatus, setCaseStatus] = useState("")
  const [wageLevel, setWageLevel] = useState("")
  const [page, setPage] = useState(0)

  const [records, setRecords] = useState<LCARecord[]>([])
  const [employers, setEmployers] = useState<EmployerLCAStats[]>([])
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    setPage(0)
  }, [debouncedQuery, fiscalYear, state, caseStatus, wageLevel, tab])

  const fiscalYearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    const years: string[] = []
    for (let y = current; y >= current - 6; y--) years.push(String(y))
    return years
  }, [])

  const loadRecords = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from("lca_records")
      .select("*", { count: "exact" })
      .order("decision_date", { ascending: false, nullsFirst: false })
      .range(from, to)

    if (debouncedQuery) {
      const escaped = debouncedQuery.replace(/[%,]/g, "")
      query = query.or(
        `employer_name.ilike.%${escaped}%,job_title.ilike.%${escaped}%`
      )
    }
    if (fiscalYear) query = query.eq("fiscal_year", Number(fiscalYear))
    if (state) query = query.eq("worksite_state_abbr", state)
    if (caseStatus) query = query.eq("case_status", caseStatus)
    if (wageLevel) query = query.eq("wage_level", wageLevel)

    const { data, count: total, error } = await query
    setLoading(false)
    if (error) {
      setRecords([])
      setCount(0)
      return
    }
    setRecords((data ?? []) as LCARecord[])
    setCount(total ?? null)
  }, [debouncedQuery, fiscalYear, state, caseStatus, wageLevel, page])

  const loadEmployers = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from("employer_lca_stats")
      .select("*", { count: "exact" })
      .order("total_applications", { ascending: false })
      .range(from, to)

    if (debouncedQuery) {
      const escaped = debouncedQuery.replace(/[%,]/g, "")
      query = query.or(
        `display_name.ilike.%${escaped}%,employer_name_normalized.ilike.%${escaped}%`
      )
    }

    const { data, count: total, error } = await query
    setLoading(false)
    if (error) {
      setEmployers([])
      setCount(0)
      return
    }
    setEmployers((data ?? []) as EmployerLCAStats[])
    setCount(total ?? null)
  }, [debouncedQuery, page])

  useEffect(() => {
    if (tab === "records") void loadRecords()
    else void loadEmployers()
  }, [tab, loadRecords, loadEmployers])

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 0

  return (
    <main className="app-page">
      <div className="app-shell max-w-7xl space-y-8">
        <DashboardPageHeader
          kicker="H-1B Explorer"
          title="DOL LCA disclosure database"
          description="Search the underlying Department of Labor Labor Condition Application data powering every H-1B approval prediction on Hireoven."
          backHref="/dashboard/international"
          backLabel="Back to International Hub"
          meta={
            <span className="inline-flex items-center rounded-full border border-border bg-brand-tint px-3 py-1 text-xs font-semibold text-brand-navy">
              Public DOL data
            </span>
          }
        />

        <div className="surface-card p-6">
          <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-border pb-4">
            <button
              type="button"
              onClick={() => setTab("records")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                tab === "records"
                  ? "bg-brand-navy text-white"
                  : "bg-surface-alt text-muted-foreground hover:bg-brand-tint hover:text-brand-navy"
              }`}
            >
              LCA records
            </button>
            <button
              type="button"
              onClick={() => setTab("employers")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                tab === "employers"
                  ? "bg-brand-navy text-white"
                  : "bg-surface-alt text-muted-foreground hover:bg-brand-tint hover:text-brand-navy"
              }`}
            >
              Employer stats
            </button>
            <div className="ml-auto text-xs text-muted-foreground">
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </span>
              ) : count !== null ? (
                `${count.toLocaleString()} result${count === 1 ? "" : "s"}`
              ) : (
                ""
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1.4fr_repeat(4,1fr)]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  tab === "records"
                    ? "Search employer or job title…"
                    : "Search employer…"
                }
                className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-strong placeholder:text-muted-foreground outline-none focus:border-brand-navy"
              />
            </div>
            {tab === "records" && (
              <>
                <select
                  value={fiscalYear}
                  onChange={(event) => setFiscalYear(event.target.value)}
                  className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-strong outline-none focus:border-brand-navy"
                >
                  <option value="">All fiscal years</option>
                  {fiscalYearOptions.map((year) => (
                    <option key={year} value={year}>
                      FY {year}
                    </option>
                  ))}
                </select>
                <select
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                  className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-strong outline-none focus:border-brand-navy"
                >
                  <option value="">All states</option>
                  {US_STATES.map((abbr) => (
                    <option key={abbr} value={abbr}>
                      {abbr}
                    </option>
                  ))}
                </select>
                <select
                  value={caseStatus}
                  onChange={(event) => setCaseStatus(event.target.value)}
                  className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-strong outline-none focus:border-brand-navy"
                >
                  {CASE_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  value={wageLevel}
                  onChange={(event) => setWageLevel(event.target.value)}
                  className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-strong outline-none focus:border-brand-navy"
                >
                  {WAGE_LEVEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div className="mt-4 text-[11px] text-muted-foreground">
            Data source: U.S. Department of Labor LCA disclosure. Shown for research
            only - not legal advice.
          </div>
        </div>

        {tab === "records" ? (
          <div className="surface-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-surface-alt text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Employer</th>
                    <th className="px-4 py-3">Job title</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Wage</th>
                    <th className="px-4 py-3">Level</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading && records.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                      >
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                        Searching LCA records…
                      </td>
                    </tr>
                  ) : records.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                      >
                        No LCA records match your filters.
                      </td>
                    </tr>
                  ) : (
                    records.map((record) => (
                      <tr key={record.id} className="hover:bg-surface-alt/40">
                        <td className="px-4 py-3 font-medium text-strong">
                          {record.company_id ? (
                            <Link
                              href={`/dashboard/companies/${record.company_id}`}
                              className="hover:text-brand-navy hover:underline"
                            >
                              {record.employer_name}
                            </Link>
                          ) : (
                            record.employer_name
                          )}
                        </td>
                        <td className="px-4 py-3 text-strong">
                          {record.job_title ?? "-"}
                          {record.soc_title ? (
                            <div className="text-[11px] text-muted-foreground">
                              {record.soc_title}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {record.worksite_city ?? "-"}
                          {record.worksite_state_abbr
                            ? `, ${record.worksite_state_abbr}`
                            : ""}
                        </td>
                        <td className="px-4 py-3 text-strong">
                          {formatCurrency(record.wage_rate_from)}
                          {record.wage_rate_to &&
                          record.wage_rate_to !== record.wage_rate_from
                            ? ` – ${formatCurrency(record.wage_rate_to)}`
                            : ""}
                          {record.wage_unit ? (
                            <div className="text-[11px] text-muted-foreground">
                              per {record.wage_unit.toLowerCase()}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {record.wage_level ?? "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-semibold ${statusTone(
                              record.case_status
                            )}`}
                          >
                            {record.case_status ?? "Unknown"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {record.decision_date ?? "-"}
                          {record.fiscal_year ? (
                            <div className="text-[11px] text-muted-foreground">
                              FY {record.fiscal_year}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="surface-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-surface-alt text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Employer</th>
                    <th className="px-4 py-3">Applications</th>
                    <th className="px-4 py-3">Certified</th>
                    <th className="px-4 py-3">Denied</th>
                    <th className="px-4 py-3">Approval rate</th>
                    <th className="px-4 py-3">Trend</th>
                    <th className="px-4 py-3">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading && employers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                      >
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                        Loading employer stats…
                      </td>
                    </tr>
                  ) : employers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                      >
                        No employers match your search.
                      </td>
                    </tr>
                  ) : (
                    employers.map((employer) => {
                      const approval =
                        employer.certification_rate !== null
                          ? Math.round(employer.certification_rate * 100)
                          : null
                      return (
                        <tr
                          key={employer.id}
                          className="hover:bg-surface-alt/40"
                        >
                          <td className="px-4 py-3 font-medium text-strong">
                            {employer.company_id ? (
                              <Link
                                href={`/dashboard/companies/${employer.company_id}`}
                                className="hover:text-brand-navy hover:underline"
                              >
                                {employer.display_name ??
                                  employer.employer_name_normalized}
                              </Link>
                            ) : (
                              employer.display_name ??
                              employer.employer_name_normalized
                            )}
                          </td>
                          <td className="px-4 py-3 text-strong tabular-nums">
                            {employer.total_applications.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-emerald-700 tabular-nums">
                            {employer.total_certified.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-red-700 tabular-nums">
                            {employer.total_denied.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-semibold tabular-nums text-strong">
                            {approval === null ? "-" : `${approval}%`}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground capitalize">
                            {employer.approval_trend ?? "stable"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {employer.is_staffing_firm && (
                                <span className="inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                  Staffing
                                </span>
                              )}
                              {employer.is_consulting_firm && (
                                <span className="inline-flex rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                                  Consulting
                                </span>
                              )}
                              {employer.has_high_denial_rate && (
                                <span className="inline-flex rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                  High denials
                                </span>
                              )}
                              {employer.is_first_time_filer && (
                                <span className="inline-flex rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                  New filer
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <button
              type="button"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-lg border border-border bg-surface px-4 py-2 font-semibold text-strong transition hover:border-brand-navy disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-muted-foreground">
              Page {page + 1} of {totalPages.toLocaleString()}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-border bg-surface px-4 py-2 font-semibold text-strong transition hover:border-brand-navy disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
