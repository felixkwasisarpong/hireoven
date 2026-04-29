"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  Building2,
  Download,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react"
import AddCompanyModal from "@/components/admin/AddCompanyModal"
import { useToast } from "@/components/ui/ToastProvider"
import { formatDateTime, formatNumber, formatRelativeTime, downloadCsv } from "@/lib/admin/format"
import { cn } from "@/lib/utils"
import type { AtsType, Company, CrawlLog } from "@/types"

type SortKey = "name" | "domain" | "ats" | "status" | "last_crawled" | "job_count" | "h1b"

function getHealth(company: Company, crawl: CrawlLog | null) {
  if (!company.last_crawled_at) return { label: "Never", tone: "neutral" as const }
  if (
    crawl?.status === "failed" ||
    crawl?.status === "blocked" ||
    crawl?.status === "fetch_error"
  )
    return { label: "Failed", tone: "danger" as const }
  if (crawl?.status === "bad_url") return { label: "Bad URL", tone: "warning" as const }
  const hours = (Date.now() - new Date(company.last_crawled_at).getTime()) / 3_600_000
  if (hours <= 2) return { label: "Healthy", tone: "success" as const }
  if (hours <= 12) return { label: "Stale", tone: "warning" as const }
  return { label: "Overdue", tone: "danger" as const }
}

const DOT: Record<string, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-400",
  danger: "bg-red-500",
  neutral: "bg-slate-300",
}

const ATS_OPTIONS = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "bamboohr",
  "icims",
  "jobvite",
  "custom",
]

export default function AdminCompaniesPage() {
  const { pushToast } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [latestCrawls, setLatestCrawls] = useState<Map<string, CrawlLog>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [atsFilter, setAtsFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [healthFilter, setHealthFilter] = useState("all")
  const [sort, setSort] = useState<SortKey>("name")
  const [selected, setSelected] = useState<string[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    const [companiesRes, crawlRes] = await Promise.all([
      fetch("/api/admin/companies"),
      fetch("/api/admin/crawl-logs"),
    ])

    if (!companiesRes.ok) {
      pushToast({ tone: "error", title: "Unable to load companies" })
      setLoading(false)
      return
    }

    const { companies: companiesData } = (await companiesRes.json()) as {
      companies: Company[]
    }
    const crawlData: CrawlLog[] = crawlRes.ok
      ? ((await crawlRes.json()) as { crawlLogs: CrawlLog[] }).crawlLogs
      : []

    const map = new Map<string, CrawlLog>()
    for (const crawl of crawlData) {
      if (!map.has(crawl.company_id)) map.set(crawl.company_id, crawl)
    }

    setCompanies(companiesData ?? [])
    setLatestCrawls(map)
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const visibleCompanies = useMemo(() => {
    const filtered = companies.filter((company) => {
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        company.name.toLowerCase().includes(q) ||
        company.domain.toLowerCase().includes(q)
      const matchesAts = !atsFilter || company.ats_type === atsFilter
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && company.is_active) ||
        (statusFilter === "inactive" && !company.is_active)
      const crawl = latestCrawls.get(company.id) ?? null
      const health = getHealth(company, crawl)
      const matchesHealth = healthFilter === "all" || health.tone === healthFilter
      return matchesSearch && matchesAts && matchesStatus && matchesHealth
    })

    return filtered.sort((a, b) => {
      if (sort === "domain") return a.domain.localeCompare(b.domain)
      if (sort === "ats") return (a.ats_type ?? "").localeCompare(b.ats_type ?? "")
      if (sort === "status") return Number(b.is_active) - Number(a.is_active)
      if (sort === "last_crawled")
        return (
          new Date(b.last_crawled_at ?? 0).getTime() -
          new Date(a.last_crawled_at ?? 0).getTime()
        )
      if (sort === "job_count") return b.job_count - a.job_count
      if (sort === "h1b") return b.sponsorship_confidence - a.sponsorship_confidence
      return a.name.localeCompare(b.name)
    })
  }, [atsFilter, companies, healthFilter, latestCrawls, search, sort, statusFilter])

  async function toggleCompany(company: Company, nextValue: boolean) {
    setBusyId(company.id)
    const res = await fetch(`/api/admin/companies/${company.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: nextValue }),
    })
    setBusyId(null)
    if (!res.ok) {
      pushToast({ tone: "error", title: "Unable to update company", description: "Request failed" })
      return
    }
    setCompanies((curr) =>
      curr.map((c) => (c.id === company.id ? { ...c, is_active: nextValue } : c))
    )
    pushToast({
      tone: "success",
      title: nextValue ? "Company activated" : "Company deactivated",
      description: company.name,
    })
  }

  async function crawlCompanies(type: "all" | "selected" | "company", ids?: string[]) {
    if (type !== "company" && !window.confirm("Start crawl jobs for the selected companies now?"))
      return
    setBusyId(type === "company" ? (ids?.[0] ?? null) : "__bulk__")
    const requests =
      type === "company"
        ? [{ type: "company", id: ids?.[0] }]
        : type === "selected"
          ? (ids?.map((id) => ({ type: "company" as const, id })) ?? [])
          : [{ type: "all" as const }]
    try {
      for (const req of requests) {
        await fetch("/api/admin/crawl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        })
      }
      pushToast({
        tone: "success",
        title: "Crawl started",
        description:
          type === "all"
            ? "All active companies are being crawled."
            : `${ids?.length ?? 1} compan${ids?.length === 1 ? "y" : "ies"} queued.`,
      })
      await loadData()
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Unable to start crawl",
        description: (error as Error).message,
      })
    } finally {
      setBusyId(null)
    }
  }

  async function bulkUpdate(nextValue: boolean) {
    if (!selected.length) return
    if (!window.confirm("Apply this bulk status change to the selected companies?")) return
    const results = await Promise.all(
      selected.map((id) =>
        fetch(`/api/admin/companies/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: nextValue }),
        })
      )
    )
    if (results.some((r) => !r.ok)) {
      pushToast({ tone: "error", title: "Bulk update failed" })
      return
    }
    setCompanies((curr) =>
      curr.map((c) => (selected.includes(c.id) ? { ...c, is_active: nextValue } : c))
    )
    pushToast({
      tone: "success",
      title: "Bulk update complete",
      description: `${selected.length} companies updated.`,
    })
  }

  async function deleteCompany(company: Company) {
    if (!window.confirm(`Delete ${company.name} and all associated jobs?`)) return
    const res = await fetch(`/api/admin/companies/${company.id}`, { method: "DELETE" })
    if (!res.ok) {
      pushToast({ tone: "error", title: "Delete failed" })
      return
    }
    setCompanies((curr) => curr.filter((c) => c.id !== company.id))
    pushToast({ tone: "success", title: "Company deleted", description: company.name })
  }

  function exportCompanies() {
    downloadCsv("hireoven-companies.csv", [
      ["Name", "Domain", "ATS", "Active", "Last crawled", "Job count", "H1B score"],
      ...visibleCompanies.map((c) => [
        c.name,
        c.domain,
        c.ats_type ?? "",
        String(c.is_active),
        c.last_crawled_at ?? "",
        String(c.job_count),
        String(c.sponsorship_confidence),
      ]),
    ])
  }

  const allChecked =
    visibleCompanies.length > 0 && selected.length === visibleCompanies.length

  return (
    <>
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="border-b border-gray-100 bg-white px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-sky-600">
              Admin
            </p>
            <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight text-gray-950">
              Companies
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCompanies}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500 transition hover:border-gray-300 hover:bg-gray-50"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
            <button
              onClick={() => void crawlCompanies("all")}
              disabled={busyId === "__bulk__"}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              {busyId === "__bulk__" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Crawl all
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add company
            </button>
          </div>
        </div>

        {/* ── Toolbar ─────────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies…"
              className="h-8 w-60 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-900 outline-none placeholder:text-gray-400 transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/15"
            />
          </div>

          {/* ATS select */}
          <select
            value={atsFilter}
            onChange={(e) => setAtsFilter(e.target.value)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-medium outline-none transition",
              atsFilter
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
            )}
          >
            <option value="">All ATS</option>
            {ATS_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>

          {/* Status chips */}
          <div className="flex items-center gap-px rounded-lg border border-gray-200 bg-white p-0.5">
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["inactive", "Inactive"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
                  statusFilter === value
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-400 hover:text-gray-700"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Health chips */}
          <div className="flex items-center gap-px rounded-lg border border-gray-200 bg-white p-0.5">
            {(
              [
                ["all", "All health"],
                ["success", "Healthy"],
                ["warning", "Stale"],
                ["danger", "Failed"],
                ["neutral", "Never"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setHealthFilter(value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
                  healthFilter === value
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-400 hover:text-gray-700"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Right-side: count + sort */}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-gray-400">
              {formatNumber(visibleCompanies.length)} companies
            </span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-500 outline-none transition hover:border-gray-300"
            >
              <option value="name">Sort: Name</option>
              <option value="domain">Sort: Domain</option>
              <option value="ats">Sort: ATS</option>
              <option value="status">Sort: Status</option>
              <option value="last_crawled">Sort: Last crawled</option>
              <option value="job_count">Sort: Jobs</option>
              <option value="h1b">Sort: H1B score</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-28 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading companies…</span>
          </div>
        ) : visibleCompanies.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-28 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
              <Building2 className="h-6 w-6 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-600">No companies match your filters</p>
            <p className="text-xs text-gray-400">Try adjusting the search or filter chips above</p>
          </div>
        ) : (
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-12 py-3 pl-8 pr-3">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) =>
                      setSelected(e.target.checked ? visibleCompanies.map((c) => c.id) : [])
                    }
                    className="rounded border-gray-300 accent-sky-600"
                  />
                </th>
                {[
                  "Company",
                  "ATS",
                  "Status",
                  "Jobs",
                  "H1B",
                  "Health",
                  "Last crawled",
                  "",
                ].map((col) => (
                  <th
                    key={col}
                    className="py-3 pr-6 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibleCompanies.map((company) => {
                const crawl = latestCrawls.get(company.id) ?? null
                const health = getHealth(company, crawl)
                const isSelected = selected.includes(company.id)

                return (
                  <tr
                    key={company.id}
                    className={cn(
                      "group transition-colors",
                      isSelected ? "bg-sky-50/50" : "hover:bg-gray-50/70"
                    )}
                  >
                    {/* Checkbox */}
                    <td className="py-4 pl-8 pr-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) =>
                          setSelected((curr) =>
                            e.target.checked
                              ? [...curr, company.id]
                              : curr.filter((id) => id !== company.id)
                          )
                        }
                        className="rounded border-gray-300 accent-sky-600"
                      />
                    </td>

                    {/* Company */}
                    <td className="py-3.5 pr-6">
                      <div className="flex items-center gap-3">
                        {company.logo_url ? (
                          <img
                            src={company.logo_url}
                            alt=""
                            className="h-8 w-8 flex-shrink-0 rounded-xl border border-gray-100 bg-gray-50 object-contain"
                          />
                        ) : (
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-100 to-sky-200 text-xs font-bold text-sky-700">
                            {company.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="max-w-[180px] truncate text-sm font-semibold text-gray-900">
                            {company.name}
                          </p>
                          <p className="max-w-[180px] truncate text-[11px] text-gray-400">
                            {company.domain}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* ATS */}
                    <td className="py-3.5 pr-6">
                      {company.ats_type ? (
                        <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {company.ats_type}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>

                    {/* Status toggle */}
                    <td className="py-3.5 pr-6">
                      <button
                        onClick={() => void toggleCompany(company, !company.is_active)}
                        disabled={busyId === company.id}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                          company.is_active
                            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            company.is_active ? "bg-emerald-500" : "bg-gray-400"
                          )}
                        />
                        {company.is_active ? "Active" : "Inactive"}
                      </button>
                    </td>

                    {/* Jobs */}
                    <td className="py-3.5 pr-6">
                      <span className="text-sm font-semibold tabular-nums text-gray-800">
                        {formatNumber(company.job_count)}
                      </span>
                    </td>

                    {/* H1B */}
                    <td className="py-3.5 pr-6">
                      <span className="text-sm tabular-nums text-gray-500">
                        {formatNumber(company.sponsorship_confidence)}
                      </span>
                    </td>

                    {/* Health */}
                    <td className="py-3.5 pr-6">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "h-2 w-2 flex-shrink-0 rounded-full",
                            DOT[health.tone]
                          )}
                        />
                        <div>
                          <p className="text-xs font-medium text-gray-700">{health.label}</p>
                          <p className="text-[10px] text-gray-400">{crawl?.status ?? "never"}</p>
                        </div>
                      </div>
                    </td>

                    {/* Last crawled */}
                    <td className="py-3.5 pr-6">
                      <p className="text-xs font-medium text-gray-700">
                        {formatRelativeTime(company.last_crawled_at)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatDateTime(company.last_crawled_at)}
                      </p>
                    </td>

                    {/* Actions (hover-reveal) */}
                    <td className="py-3.5 pr-8">
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => void crawlCompanies("company", [company.id])}
                          disabled={busyId === company.id}
                          title="Crawl now"
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
                        >
                          {busyId === company.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <Link
                          href={`/admin/companies/${company.id}/edit`}
                          title="Edit"
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                        <Link
                          href={`/admin/jobs?company=${company.id}`}
                          title="View jobs"
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                        <button
                          onClick={() => void deleteCompany(company)}
                          title="Delete"
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Floating bulk bar ───────────────────────────────── */}
      {selected.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white px-5 py-2.5 shadow-[0_20px_60px_rgba(15,23,42,0.14)] ring-1 ring-black/[0.04]">
            <span className="text-sm font-semibold text-gray-900 tabular-nums">
              {selected.length} selected
            </span>
            <div className="h-4 w-px bg-gray-200" />
            <button
              onClick={() => void bulkUpdate(true)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
            >
              Activate
            </button>
            <button
              onClick={() => void bulkUpdate(false)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-100"
            >
              Deactivate
            </button>
            <button
              onClick={() => void crawlCompanies("selected", selected)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50"
            >
              Crawl now
            </button>
            <div className="h-4 w-px bg-gray-200" />
            <button
              onClick={() => setSelected([])}
              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <AddCompanyModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={(company) => setCompanies((curr) => [company, ...curr])}
      />
    </>
  )
}
