"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Database,
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react"
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

function formatCurrency(v: number | null) {
  if (v === null || Number.isNaN(v)) return "—"
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`
  return `$${v}`
}

function formatCurrencyFull(v: number | null) {
  if (v === null || Number.isNaN(v)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v)
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-gray-400">—</span>
  const s = status.toLowerCase()
  const cfg =
    s.includes("certified") && s.includes("withdrawn")
      ? { dot: "bg-amber-400", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" }
      : s.includes("certified")
        ? { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" }
        : s.includes("denied")
          ? { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50", border: "border-red-200" }
          : { dot: "bg-gray-400", text: "text-gray-600", bg: "bg-gray-50", border: "border-gray-200" }

  const label = s.includes("certified") && s.includes("withdrawn") ? "Cert-Withdrawn"
    : s.includes("certified") ? "Certified"
    : s.includes("denied") ? "Denied"
    : s.includes("withdrawn") ? "Withdrawn"
    : status

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", cfg.bg, cfg.border, cfg.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {label}
    </span>
  )
}

function ApprovalBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-gray-300 text-xs">—</span>
  const pct = Math.round(rate * 100)
  const color = pct >= 90 ? "bg-emerald-500" : pct >= 75 ? "bg-amber-400" : "bg-red-400"
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-xs font-semibold tabular-nums", pct >= 90 ? "text-emerald-700" : pct >= 75 ? "text-amber-700" : "text-red-700")}>
        {pct}%
      </span>
    </div>
  )
}

function TrendIcon({ trend }: { trend: string | null }) {
  if (!trend) return null
  const t = trend.toLowerCase()
  if (t.includes("ris") || t.includes("increas") || t === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
  if (t.includes("declin") || t.includes("decreas") || t === "down") return <TrendingDown className="h-3.5 w-3.5 text-red-500" />
  return <Minus className="h-3.5 w-3.5 text-gray-400" />
}

function WageLevelPill({ level }: { level: string | null }) {
  if (!level) return <span className="text-gray-300">—</span>
  const colors: Record<string, string> = {
    "I":   "bg-blue-50 text-blue-700 border-blue-200",
    "II":  "bg-indigo-50 text-indigo-700 border-indigo-200",
    "III": "bg-violet-50 text-violet-700 border-violet-200",
    "IV":  "bg-purple-50 text-purple-700 border-purple-200",
  }
  return (
    <span className={cn("inline-flex rounded border px-2 py-0.5 text-[10px] font-bold", colors[level] ?? "bg-gray-50 text-gray-600 border-gray-200")}>
      L-{level}
    </span>
  )
}

function FilterSelect({
  value,
  onChange,
  active,
  children,
}: {
  value: string
  onChange: (v: string) => void
  active: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-8 appearance-none rounded-full border pl-3 pr-7 text-xs font-medium outline-none transition",
          active
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-current opacity-50" />
    </div>
  )
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
    const cur = new Date().getFullYear()
    return Array.from({ length: 7 }, (_, i) => String(cur - i))
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

        {/* ── Dark page header ──────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl bg-slate-950 px-6 py-6 sm:px-8 sm:py-7">
          <div className="pointer-events-none absolute right-[-40px] top-[-40px] h-56 w-56 rounded-full bg-emerald-600/20 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-60px] left-[30%] h-40 w-40 rounded-full bg-teal-400/10 blur-3xl" />

          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <Link
                href="/dashboard/international"
                className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/60 transition hover:border-white/20 hover:text-white/80"
              >
                <ArrowLeft className="h-3 w-3" />
                International Hub
              </Link>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
                  <Database className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-400">
                    DOL LCA Database
                  </p>
                  <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white">
                    H-1B LCA Explorer
                  </h1>
                </div>
              </div>
              <p className="mt-2 max-w-lg text-sm leading-6 text-white/50">
                Search Department of Labor Labor Condition Applications — the filings behind every H-1B petition.
              </p>
            </div>
            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              Public DOL data
            </span>
          </div>
        </div>

        {/* ── Toolbar ───────────────────────────────────────── */}
        <div className="surface-card p-4">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            {/* Tab switch */}
            <div className="flex items-center gap-px rounded-xl border border-gray-200 bg-white p-0.5">
              {(["records", "employers"] as TabKey[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-lg px-4 py-1.5 text-xs font-semibold transition",
                    tab === t ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  {t === "records" ? "LCA records" : "Employer stats"}
                </button>
              ))}
            </div>

            {/* Result count */}
            <span className="text-xs text-gray-400">
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                </span>
              ) : count !== null ? (
                `${count.toLocaleString()} result${count === 1 ? "" : "s"}`
              ) : null}
            </span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "records" ? "Employer or job title…" : "Search employer…"}
                className="h-8 w-full rounded-full border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-900 outline-none placeholder:text-gray-400 transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/15"
              />
            </div>

            {tab === "records" && (
              <>
                <FilterSelect value={fiscalYear} onChange={setFiscalYear} active={!!fiscalYear}>
                  <option value="">All years</option>
                  {fiscalYearOptions.map((y) => <option key={y} value={y}>FY {y}</option>)}
                </FilterSelect>
                <FilterSelect value={state} onChange={setState} active={!!state}>
                  <option value="">All states</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </FilterSelect>
                <FilterSelect value={caseStatus} onChange={setCaseStatus} active={!!caseStatus}>
                  {CASE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </FilterSelect>
                <FilterSelect value={wageLevel} onChange={setWageLevel} active={!!wageLevel}>
                  {WAGE_LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </FilterSelect>
              </>
            )}
          </div>

          <p className="mt-3 text-[10px] text-gray-400">
            U.S. Department of Labor LCA data · for research only — not legal advice
          </p>
        </div>

        {/* ── LCA Records table ─────────────────────────────── */}
        {tab === "records" && (
          <div className="surface-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Employer</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Role</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Location</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Wage</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Level</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Status</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Year</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading && records.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-20 text-center">
                        <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-400" />
                        <p className="text-sm text-gray-400">Searching LCA records…</p>
                      </td>
                    </tr>
                  ) : records.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-20 text-center">
                        <Database className="mx-auto mb-3 h-8 w-8 text-gray-200" />
                        <p className="text-sm font-medium text-gray-500">No records match your filters</p>
                        <p className="mt-1 text-xs text-gray-400">Try adjusting the search or filters above</p>
                      </td>
                    </tr>
                  ) : (
                    records.map((record) => (
                      <tr key={record.id} className="group transition-colors hover:bg-emerald-50/20">
                        <td className="px-5 py-3.5">
                          {record.company_id ? (
                            <Link
                              href={`/dashboard/companies/${record.company_id}`}
                              className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900 transition hover:text-emerald-700"
                            >
                              {record.employer_name}
                              <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                            </Link>
                          ) : (
                            <span className="text-sm font-semibold text-gray-900">{record.employer_name}</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-sm text-gray-800">{record.job_title ?? "—"}</p>
                          {record.soc_title && (
                            <p className="mt-0.5 text-[11px] text-gray-400">{record.soc_title}</p>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-500">
                          {record.worksite_city ?? "—"}
                          {record.worksite_state_abbr ? `, ${record.worksite_state_abbr}` : ""}
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-semibold tabular-nums text-gray-900">
                            {formatCurrency(record.wage_rate_from)}
                            {record.wage_rate_to && record.wage_rate_to !== record.wage_rate_from
                              ? ` – ${formatCurrency(record.wage_rate_to)}` : ""}
                          </p>
                          {record.wage_unit && (
                            <p className="text-[10px] text-gray-400">/ {record.wage_unit.toLowerCase()}</p>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <WageLevelPill level={record.wage_level ?? null} />
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusPill status={record.case_status ?? null} />
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-500">
                          {record.fiscal_year ? `FY ${record.fiscal_year}` : (record.decision_date ?? "—")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Employer Stats table ──────────────────────────── */}
        {tab === "employers" && (
          <div className="surface-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Employer</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Applications</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Certified</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Approval rate</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Trend</th>
                    <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading && employers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-20 text-center">
                        <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-400" />
                        <p className="text-sm text-gray-400">Loading employer stats…</p>
                      </td>
                    </tr>
                  ) : employers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-20 text-center">
                        <Database className="mx-auto mb-3 h-8 w-8 text-gray-200" />
                        <p className="text-sm font-medium text-gray-500">No employers match your search</p>
                      </td>
                    </tr>
                  ) : (
                    employers.map((emp) => (
                      <tr key={emp.id} className="group transition-colors hover:bg-emerald-50/20">
                        <td className="px-5 py-3.5">
                          {emp.company_id ? (
                            <Link
                              href={`/dashboard/companies/${emp.company_id}`}
                              className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900 transition hover:text-emerald-700"
                            >
                              {emp.display_name ?? emp.employer_name_normalized}
                              <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                            </Link>
                          ) : (
                            <span className="text-sm font-semibold text-gray-900">
                              {emp.display_name ?? emp.employer_name_normalized}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-bold tabular-nums text-gray-900">
                            {emp.total_applications.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            {emp.total_denied > 0 && `${emp.total_denied.toLocaleString()} denied`}
                          </p>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-semibold tabular-nums text-emerald-700">
                            {emp.total_certified.toLocaleString()}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 min-w-[140px]">
                          <ApprovalBar rate={emp.certification_rate} />
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <TrendIcon trend={emp.approval_trend} />
                            <span className="text-xs capitalize text-gray-500">
                              {emp.approval_trend ?? "stable"}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {emp.is_staffing_firm && (
                              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Staffing</span>
                            )}
                            {emp.is_consulting_firm && (
                              <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Consulting</span>
                            )}
                            {emp.has_high_denial_rate && (
                              <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">High denials</span>
                            )}
                            {emp.is_first_time_filer && (
                              <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">New filer</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
