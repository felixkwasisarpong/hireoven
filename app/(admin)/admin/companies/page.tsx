"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react"
import AddCompanyModal from "@/components/admin/AddCompanyModal"
import {
  AdminBadge,
  AdminButton,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminSelect,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { formatDateTime, formatNumber, formatRelativeTime, downloadCsv } from "@/lib/admin/format"
import { createClient } from "@/lib/supabase/client"
import type { AtsType, Company, CrawlLog } from "@/types"

type SortKey =
  | "name"
  | "domain"
  | "ats"
  | "status"
  | "last_crawled"
  | "job_count"
  | "h1b"

function getHealth(company: Company, crawl: CrawlLog | null) {
  if (!company.last_crawled_at) return { label: "Never", tone: "neutral" as const }
  if (crawl?.status === "failed") return { label: "Red", tone: "danger" as const }

  const hours = (Date.now() - new Date(company.last_crawled_at).getTime()) / 3_600_000
  if (hours <= 2) return { label: "Green", tone: "success" as const }
  if (hours <= 12) return { label: "Amber", tone: "warning" as const }
  return { label: "Red", tone: "danger" as const }
}

export default function AdminCompaniesPage() {
  const supabase = useMemo(() => createClient(), [])
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
    const [{ data: companiesData, error: companiesError }, { data: crawlData, error: crawlError }] =
      await Promise.all([
        supabase.from("companies").select("*").order("name"),
        supabase.from("crawl_logs").select("*").order("crawled_at", { ascending: false }),
      ])

    if (companiesError || crawlError) {
      pushToast({
        tone: "error",
        title: "Unable to load companies",
        description: companiesError?.message ?? crawlError?.message ?? "Unknown error",
      })
      setLoading(false)
      return
    }

    const map = new Map<string, CrawlLog>()
    for (const crawl of (crawlData ?? []) as CrawlLog[]) {
      if (!map.has(crawl.company_id)) {
        map.set(crawl.company_id, crawl)
      }
    }

    setCompanies((companiesData ?? []) as Company[])
    setLatestCrawls(map)
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const visibleCompanies = useMemo(() => {
    const filtered = companies.filter((company) => {
      const matchesSearch =
        !search.trim() ||
        company.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        company.domain.toLowerCase().includes(search.trim().toLowerCase())
      const matchesAts = !atsFilter || company.ats_type === atsFilter
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && company.is_active) ||
        (statusFilter === "inactive" && !company.is_active)
      const crawl = latestCrawls.get(company.id) ?? null
      const health = getHealth(company, crawl)
      const matchesHealth = healthFilter === "all" || health.label.toLowerCase() === healthFilter
      return matchesSearch && matchesAts && matchesStatus && matchesHealth
    })

    return filtered.sort((left, right) => {
      if (sort === "domain") return left.domain.localeCompare(right.domain)
      if (sort === "ats") return (left.ats_type ?? "").localeCompare(right.ats_type ?? "")
      if (sort === "status") return Number(right.is_active) - Number(left.is_active)
      if (sort === "last_crawled") {
        return (
          new Date(right.last_crawled_at ?? 0).getTime() -
          new Date(left.last_crawled_at ?? 0).getTime()
        )
      }
      if (sort === "job_count") return right.job_count - left.job_count
      if (sort === "h1b") return right.sponsorship_confidence - left.sponsorship_confidence
      return left.name.localeCompare(right.name)
    })
  }, [atsFilter, companies, healthFilter, latestCrawls, search, sort, statusFilter])

  async function toggleCompany(company: Company, nextValue: boolean) {
    setBusyId(company.id)
    const { error } = await ((supabase.from("companies") as any)
      .update({ is_active: nextValue } as any)
      .eq("id", company.id))
    setBusyId(null)

    if (error) {
      pushToast({
        tone: "error",
        title: "Unable to update company",
        description: error.message,
      })
      return
    }

    setCompanies((current) =>
      current.map((entry) =>
        entry.id === company.id ? { ...entry, is_active: nextValue } : entry
      )
    )
    pushToast({
      tone: "success",
      title: nextValue ? "Company activated" : "Company deactivated",
      description: company.name,
    })
  }

  async function crawlCompanies(type: "all" | "selected" | "company", ids?: string[]) {
    if (
      type !== "company" &&
      !window.confirm("Start crawl jobs for the selected companies now?")
    ) {
      return
    }

    setBusyId(type === "company" ? ids?.[0] ?? null : "__bulk__")

    const requests =
      type === "company"
        ? [{ type: "company", id: ids?.[0] }]
        : type === "selected"
          ? ids?.map((id) => ({ type: "company" as const, id })) ?? []
          : [{ type: "all" as const }]

    try {
      for (const request of requests) {
        await fetch("/api/admin/crawl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
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

    const { error } = await ((supabase.from("companies") as any)
      .update({ is_active: nextValue } as any)
      .in("id", selected))

    if (error) {
      pushToast({
        tone: "error",
        title: "Bulk update failed",
        description: error.message,
      })
      return
    }

    setCompanies((current) =>
      current.map((company) =>
        selected.includes(company.id) ? { ...company, is_active: nextValue } : company
      )
    )
    pushToast({
      tone: "success",
      title: "Bulk update complete",
      description: `${selected.length} companies updated.`,
    })
  }

  async function deleteCompany(company: Company) {
    if (!window.confirm(`Delete ${company.name} and all associated jobs?`)) return

    const { error } = await supabase.from("companies").delete().eq("id", company.id)
    if (error) {
      pushToast({
        tone: "error",
        title: "Delete failed",
        description: error.message,
      })
      return
    }

    setCompanies((current) => current.filter((entry) => entry.id !== company.id))
    pushToast({
      tone: "success",
      title: "Company deleted",
      description: company.name,
    })
  }

  function exportCompanies() {
    downloadCsv(
      "hireoven-companies.csv",
      [
        [
          "Name",
          "Domain",
          "ATS",
          "Active",
          "Last crawled",
          "Job count",
          "H1B score",
        ],
        ...visibleCompanies.map((company) => [
          company.name,
          company.domain,
          company.ats_type ?? "",
          String(company.is_active),
          company.last_crawled_at ?? "",
          String(company.job_count),
          String(company.sponsorship_confidence),
        ]),
      ]
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Companies"
        title="Company management"
        description="Track crawl health, change ATS config, and push new companies into the crawl pipeline fast."
        actions={
          <>
            <AdminButton tone="secondary" onClick={exportCompanies}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </AdminButton>
            <AdminButton tone="secondary" onClick={() => void crawlCompanies("all")}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Crawl all now
            </AdminButton>
            <AdminButton onClick={() => setShowAddModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add company
            </AdminButton>
          </>
        }
      />

      <AdminPanel
        title="Filters and bulk actions"
        description="Search by name or domain, narrow by ATS and crawl health, then act on groups of companies at once."
      >
        <div className="grid gap-3 lg:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
            <AdminInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or domain"
              className="pl-9"
            />
          </div>
          <AdminSelect value={atsFilter} onChange={(event) => setAtsFilter(event.target.value)}>
            <option value="">All ATS types</option>
            {["greenhouse", "lever", "ashby", "workday", "bamboohr", "icims", "custom"].map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              )
            )}
          </AdminSelect>
          <AdminSelect
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </AdminSelect>
          <AdminSelect
            value={healthFilter}
            onChange={(event) => setHealthFilter(event.target.value)}
          >
            <option value="all">All crawl health</option>
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="red">Red</option>
            <option value="never">Never</option>
          </AdminSelect>
          <AdminSelect value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="name">Sort by name</option>
            <option value="domain">Sort by domain</option>
            <option value="ats">Sort by ATS</option>
            <option value="status">Sort by status</option>
            <option value="last_crawled">Sort by last crawled</option>
            <option value="job_count">Sort by job count</option>
            <option value="h1b">Sort by H1B score</option>
          </AdminSelect>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <AdminButton tone="secondary" onClick={() => void bulkUpdate(true)}>
            Activate selected
          </AdminButton>
          <AdminButton tone="secondary" onClick={() => void bulkUpdate(false)}>
            Deactivate selected
          </AdminButton>
          <AdminButton
            tone="secondary"
            onClick={() => void crawlCompanies("selected", selected)}
          >
            Crawl selected
          </AdminButton>
          <span className="text-sm text-gray-500">
            {formatNumber(selected.length)} selected
          </span>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Tracked companies"
        description={`${formatNumber(visibleCompanies.length)} companies in the current view.`}
      >
        {loading ? (
          <div className="flex items-center gap-3 py-12 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading companies
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-[0.24em] text-gray-500">
                  <th className="pb-3 pr-4">
                    <input
                      type="checkbox"
                      checked={
                        visibleCompanies.length > 0 &&
                        selected.length === visibleCompanies.length
                      }
                      onChange={(event) =>
                        setSelected(event.target.checked ? visibleCompanies.map((company) => company.id) : [])
                      }
                    />
                  </th>
                  <th className="pb-3 pr-4">Name</th>
                  <th className="pb-3 pr-4">Domain</th>
                  <th className="pb-3 pr-4">ATS</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Last crawled</th>
                  <th className="pb-3 pr-4">Job count</th>
                  <th className="pb-3 pr-4">Crawl health</th>
                  <th className="pb-3 pr-4">H1B score</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleCompanies.map((company) => {
                  const crawl = latestCrawls.get(company.id) ?? null
                  const health = getHealth(company, crawl)
                  return (
                    <tr key={company.id} className="border-b border-gray-100 align-top">
                      <td className="py-4 pr-4">
                        <input
                          type="checkbox"
                          checked={selected.includes(company.id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, company.id]
                                : current.filter((id) => id !== company.id)
                            )
                          }
                        />
                      </td>
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sm font-semibold text-sky-700">
                            {company.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{company.name}</p>
                            <p className="text-xs text-gray-500">
                              {company.industry ?? "No industry"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 pr-4 text-gray-600">{company.domain}</td>
                      <td className="py-4 pr-4">
                        <AdminBadge tone="dark">{company.ats_type ?? "custom"}</AdminBadge>
                      </td>
                      <td className="py-4 pr-4">
                        <button
                          type="button"
                          onClick={() => void toggleCompany(company, !company.is_active)}
                          className="text-left"
                          disabled={busyId === company.id}
                        >
                          <AdminBadge tone={company.is_active ? "success" : "neutral"}>
                            {company.is_active ? "Active" : "Inactive"}
                          </AdminBadge>
                        </button>
                      </td>
                      <td className="py-4 pr-4">
                        <p className="font-medium text-gray-900">
                          {formatRelativeTime(company.last_crawled_at)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDateTime(company.last_crawled_at)}
                        </p>
                      </td>
                      <td className="py-4 pr-4 font-semibold text-gray-900">
                        {formatNumber(company.job_count)}
                      </td>
                      <td className="py-4 pr-4">
                        <div className="space-y-2">
                          <AdminBadge tone={health.tone}>{health.label}</AdminBadge>
                          <p className="text-xs text-gray-500">{crawl?.status ?? "never"}</p>
                        </div>
                      </td>
                      <td className="py-4 pr-4 font-semibold text-gray-900">
                        {formatNumber(company.sponsorship_confidence)}
                      </td>
                      <td className="py-4">
                        <div className="flex flex-wrap gap-2">
                          <AdminButton
                            tone="secondary"
                            className="px-3 py-2 text-xs"
                            onClick={() => void crawlCompanies("company", [company.id])}
                            disabled={busyId === company.id}
                          >
                            Crawl now
                          </AdminButton>
                          <Link
                            href={`/admin/companies/${company.id}/edit`}
                            className="inline-flex items-center rounded-2xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                          >
                            Edit
                          </Link>
                          <Link
                            href={`/admin/jobs?company=${company.id}`}
                            className="inline-flex items-center rounded-2xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                          >
                            View jobs
                          </Link>
                          <button
                            type="button"
                            onClick={() => void deleteCompany(company)}
                            className="inline-flex items-center rounded-2xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminPanel>

      <AddCompanyModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={(company) => setCompanies((current) => [company, ...current])}
      />
    </div>
  )
}
