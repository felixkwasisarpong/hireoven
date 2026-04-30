"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronDown, Database, Loader2, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { EmployerLCAStats, LCARecord } from "@/types"

const PAGE_SIZE = 50

const CASE_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "Certified", label: "Certified" },
  { value: "Denied", label: "Denied" },
  { value: "Withdrawn", label: "Withdrawn" },
  { value: "Certified-Withdrawn", label: "Cert-Withdrawn" },
]

const WAGE_LEVEL_OPTIONS = [
  { value: "", label: "All levels" },
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
  if (value === null || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function statusStyle(status: string | null) {
  if (!status) return "border-gray-200 bg-gray-50 text-gray-500"
  const s = status.toLowerCase()
  if (s.includes("certified") && s.includes("withdrawn"))
    return "border-amber-200 bg-amber-50 text-amber-700"
  if (s.includes("certified")) return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (s.includes("denied")) return "border-red-200 bg-red-50 text-red-700"
  if (s.includes("withdrawn")) return "border-gray-200 bg-gray-50 text-gray-600"
  return "border-slate-200 bg-slate-50 text-slate-700"
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
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => { setPage(0) }, [debouncedQuery, fiscalYear, state, caseStatus, wageLevel, tab])

  const fiscalYearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    const years: string[] = []
    for (let y = current; y >= current - 6; y--) years.push(String(y))
    return years
  }, [])

  const loadRecords = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ tab: "records", page: String(page), pageSize: String(PAGE_SIZE) })
    if (debouncedQuery) params.set("q", debouncedQuery)
    if (fiscalYear) params.set("fiscalYear", fiscalYear)
    if (state) params.set("state", state)
    if (caseStatus) params.set("caseStatus", caseStatus)
    if (wageLevel) params.set("wageLevel", wageLevel)
    const res = await fetch(`/api/h1b/explorer?${params}`, { cache: "no-store" })
    setLoading(false)
    if (!res.ok) { setRecords([]); setCount(0); return }
    const body = (await res.json()) as { records?: LCARecord[]; count?: number }
    setRecords(body.records ?? [])
    setCount(typeof body.count === "number" ? body.count : null)
  }, [debouncedQuery, fiscalYear, state, caseStatus, wageLevel, page])

  const loadEmployers = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ tab: "employers", page: String(page), pageSize: String(PAGE_SIZE) })
    if (debouncedQuery) params.set("q", debouncedQuery)
    const res = await fetch(`/api/h1b/explorer?${params}`, { cache: "no-store" })
    setLoading(false)
    if (!res.ok) { setEmployers([]); setCount(0); return }
    const body = (await res.json()) as { employers?: EmployerLCAStats[]; count?: number }
    setEmployers(body.employers ?? [])
    setCount(typeof body.count === "number" ? body.count : null)
  }, [debouncedQuery, page])

  useEffect(() => {
    if (tab === "records") void loadRecords()
    else void loadEmployers()
  }, [tab, loadRecords, loadEmployers])

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 0

  return (
    <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">
      <div className="app-shell max-w-7xl space-y-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))]">

        {/* ── Page header ───────────────────────────────────── */}
        <div>
          <Link
            href="/dashboard/international"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition hover:text-gray-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            International Hub
          </Link>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50">
                <Database className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-600">
                  DOL LCA Database
                </p>
                <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-gray-900">
                  H-1B LCA Explorer
                </h1>
              </div>
            </div>
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Public DOL data
            </span>
          </div>
        </div>

        {/* ── Filter toolbar ─────────────────────────────────── */}
        <div className="surface-card p-4">
          {/* Tab switch + result count */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-px rounded-xl border border-gray-200 bg-white p-0.5">
              {(["records", "employers"] as TabKey[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-lg px-4 py-1.5 text-xs font-semibold transition",
                    tab === t
                      ? "bg-gray-900 text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  {t === "records" ? "LCA records" : "Employer stats"}
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-400">
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                </span>
              ) : count !== null ? (
                `${count.toLocaleString()} result${count === 1 ? "" : "s"}`
              ) : null}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "records" ? "Search employer or job title…" : "Search employer…"}
                className="h-8 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-900 outline-none placeholder:text-gray-400 transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/15"
              />
            </div>

            {tab === "records" && (
              <>
                {/* Fiscal year */}
                <div className="relative">
                  <select
                    value={fiscalYear}
                    onChange={(e) => setFiscalYear(e.target.value)}
                    className={cn(
                      "h-8 appearance-none rounded-lg border pl-3 pr-7 text-xs font-medium outline-none transition",
                      fiscalYear
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    )}
                  >
                    <option value="">All years</option>
                    {fiscalYearOptions.map((y) => (
                      <option key={y} value={y}>FY {y}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                </div>

                {/* State */}
                <div className="relative">
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className={cn(
                      "h-8 appearance-none rounded-lg border pl-3 pr-7 text-xs font-medium outline-none transition",
                      state
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    )}
                  >
                    <option value="">All states</option>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                </div>

                {/* Status */}
                <div className="relative">
                  <select
                    value={caseStatus}
                    onChange={(e) => setCaseStatus(e.target.value)}
                    className={cn(
                      "h-8 appearance-none rounded-lg border pl-3 pr-7 text-xs font-medium outline-none transition",
                      caseStatus
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    )}
                  >
                    {CASE_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                </div>

                {/* Wage level */}
                <div className="relative">
                  <select
                    value={wageLevel}
                    onChange={(e) => setWageLevel(e.target.value)}
                    className={cn(
                      "h-8 appearance-none rounded-lg border pl-3 pr-7 text-xs font-medium outline-none transition",
                      wageLevel
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    )}
                  >
                    {WAGE_LEVEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                </div>
              </>
            )}
          </div>

          <p className="mt-3 text-[10px] text-gray-400">
            U.S. Department of Labor LCA disclosure data · for research only, not legal advice
          </p>
        </div>

        {/* ── Data table ─────────────────────────────────────── */}
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            {tab === "records" ? (
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {["Employer", "Job title", "Location", "Wage", "Level", "Status", "Decision"].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading && records.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-16 text-center">
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-gray-400" />
                        <p className="text-sm text-gray-400">Searching LCA records…</p>
                      </td>
                    </tr>
                  ) : records.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-16 text-center text-sm text-gray-400">
                        No LCA records match your filters.
                      </td>
                    </tr>
                  ) : (
                    records.map((record) => (
                      <tr key={record.id} className="transition-colors hover:bg-gray-50/60">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {record.company_id ? (
                            <Link
                              href={`/dashboard/companies/${record.company_id}`}
                              className="transition hover:text-indigo-700 hover:underline"
                            >
                              {record.employer_name}
                            </Link>
                          ) : record.employer_name}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          <p>{record.job_title ?? "—"}</p>
                          {record.soc_title && (
                            <p className="text-[11px] text-gray-400">{record.soc_title}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {record.worksite_city ?? "—"}
                          {record.worksite_state_abbr ? `, ${record.worksite_state_abbr}` : ""}
                        </td>
                        <td className="px-4 py-3 text-gray-900">
                          <p>{formatCurrency(record.wage_rate_from)}
                            {record.wage_rate_to && record.wage_rate_to !== record.wage_rate_from
                              ? ` – ${formatCurrency(record.wage_rate_to)}` : ""}
                          </p>
                          {record.wage_unit && (
                            <p className="text-[11px] text-gray-400">per {record.wage_unit.toLowerCase()}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{record.wage_level ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "inline-flex rounded border px-2 py-0.5 text-[11px] font-semibold",
                            statusStyle(record.case_status)
                          )}>
                            {record.case_status ?? "Unknown"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          <p>{record.decision_date ?? "—"}</p>
                          {record.fiscal_year && (
                            <p className="text-[11px] text-gray-400">FY {record.fiscal_year}</p>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {["Employer", "Applications", "Certified", "Denied", "Approval rate", "Trend", "Flags"].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading && employers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-16 text-center">
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-gray-400" />
                        <p className="text-sm text-gray-400">Loading employer stats…</p>
                      </td>
                    </tr>
                  ) : employers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-16 text-center text-sm text-gray-400">
                        No employers match your search.
                      </td>
                    </tr>
                  ) : (
                    employers.map((employer) => {
                      const approval = employer.certification_rate !== null
                        ? Math.round(employer.certification_rate * 100)
                        : null
                      return (
                        <tr key={employer.id} className="transition-colors hover:bg-gray-50/60">
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {employer.company_id ? (
                              <Link
                                href={`/dashboard/companies/${employer.company_id}`}
                                className="transition hover:text-indigo-700 hover:underline"
                              >
                                {employer.display_name ?? employer.employer_name_normalized}
                              </Link>
                            ) : (employer.display_name ?? employer.employer_name_normalized)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-gray-900">
                            {employer.total_applications.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 tabular-nums font-medium text-emerald-700">
                            {employer.total_certified.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 tabular-nums font-medium text-red-600">
                            {employer.total_denied.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-semibold tabular-nums text-gray-900">
                            {approval === null ? "—" : `${approval}%`}
                          </td>
                          <td className="px-4 py-3 capitalize text-gray-500">
                            {employer.approval_trend ?? "stable"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {employer.is_staffing_firm && (
                                <span className="inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Staffing</span>
                              )}
                              {employer.is_consulting_firm && (
                                <span className="inline-flex rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">Consulting</span>
                              )}
                              {employer.has_high_denial_rate && (
                                <span className="inline-flex rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">High denials</span>
                              )}
                              {employer.is_first_time_filer && (
                                <span className="inline-flex rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">New filer</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {page + 1} of {totalPages.toLocaleString()}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}

        <div aria-hidden className="h-[clamp(2rem,5vh,4rem)] shrink-0" />
      </div>
    </main>
  )
}
