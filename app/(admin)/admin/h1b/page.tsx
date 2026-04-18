"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search, UploadCloud } from "lucide-react"
import {
  AdminBadge,
  AdminButton,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { formatNumber } from "@/lib/admin/format"
import { createClient } from "@/lib/supabase/client"
import type { Company, H1BRecord } from "@/types"

type H1BRow = H1BRecord & {
  company: Pick<Company, "id" | "name"> | null
}

type ImportResult = {
  processed: number
  matched: number
  skipped: number
  scoresUpdated: number
  unmatchedEmployers: string[]
}

function calcConfidence(total1yr: number, approvalRate: number) {
  let score = 0
  if (total1yr > 0) score += 70
  if (approvalRate > 0.8) score += 10
  if (total1yr > 10) score += 10
  if (total1yr > 50) score += 10
  return Math.min(100, score)
}

export default function AdminH1BPage() {
  const supabase = useMemo(() => createClient(), [])
  const { pushToast } = useToast()
  const [records, setRecords] = useState<H1BRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState("")
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [matchDrafts, setMatchDrafts] = useState<Record<string, string>>({})
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    const [{ data: recordsData, error: recordsError }, { data: companiesData, error: companiesError }] =
      await Promise.all([
        (supabase
          .from("h1b_records")
          .select("*, company:companies(id, name)")
          .order("year", { ascending: false }) as any),
        supabase.from("companies").select("*").order("name"),
      ])

    if (recordsError || companiesError) {
      pushToast({
        tone: "error",
        title: "Unable to load H1B data",
        description: recordsError?.message ?? companiesError?.message ?? "Unknown error",
      })
      setLoading(false)
      return
    }

    setRecords((recordsData ?? []) as H1BRow[])
    setCompanies((companiesData ?? []) as Company[])
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel("admin-h1b-records")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "h1b_records" },
        () => void loadData()
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase])

  const visibleRecords = useMemo(() => {
    const query = search.trim().toLowerCase()
    return records.filter((record) => {
      const matchesSearch =
        !query ||
        record.employer_name.toLowerCase().includes(query) ||
        record.company?.name?.toLowerCase().includes(query)
      const matchesUnmatched = !showUnmatchedOnly || !record.company_id
      return matchesSearch && matchesUnmatched
    })
  }, [records, search, showUnmatchedOnly])

  const unmatchedRecords = visibleRecords.filter((record) => !record.company_id)

  async function handleUpload(file: File) {
    setUploading(true)
    setImportResult(null)
    const formData = new FormData()
    formData.append("file", file)

    const response = await fetch("/api/h1b/import", {
      method: "POST",
      body: formData,
    })
    const body = (await response.json()) as { error?: string } & Partial<ImportResult>
    setUploading(false)

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Import failed",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setImportResult({
      processed: body.processed ?? 0,
      matched: body.matched ?? 0,
      skipped: body.skipped ?? 0,
      scoresUpdated: body.scoresUpdated ?? 0,
      unmatchedEmployers: body.unmatchedEmployers ?? [],
    })
    pushToast({
      tone: "success",
      title: "H1B import complete",
      description: `${body.processed ?? 0} employer groups processed.`,
    })
    await loadData()
  }

  async function manuallyMatch(record: H1BRow) {
    const companyId = matchDrafts[record.id]
    if (!companyId) {
      pushToast({
        tone: "error",
        title: "Select a company first",
      })
      return
    }

    const selectedCompany = companies.find((company) => company.id === companyId)
    if (!selectedCompany) return

    setBusyMatchId(record.id)
    const approvalRate =
      record.total_petitions && record.total_petitions > 0
        ? (record.approved ?? 0) / record.total_petitions
        : 0

    const [recordResponse, companyResponse] = await Promise.all([
      (supabase.from("h1b_records") as any)
        .update({ company_id: companyId } as any)
        .eq("id", record.id),
      (supabase.from("companies") as any)
        .update(
          {
            h1b_sponsor_count_1yr: record.approved ?? 0,
            sponsors_h1b: (record.approved ?? 0) > 0,
            sponsorship_confidence: calcConfidence(record.approved ?? 0, approvalRate),
          } as any
        )
        .eq("id", companyId),
    ])
    setBusyMatchId(null)

    if (recordResponse.error || companyResponse.error) {
      pushToast({
        tone: "error",
        title: "Manual match failed",
        description:
          recordResponse.error?.message ??
          companyResponse.error?.message ??
          "Unknown error",
      })
      return
    }

    pushToast({
      tone: "success",
      title: "Company matched",
      description: `${record.employer_name} now maps to ${selectedCompany.name}.`,
    })
    await loadData()
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="H1B data"
        title="USCIS sponsorship operations"
        description="Import petition data, inspect which employers still need manual mapping, and keep company sponsorship scores grounded in real USCIS history."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="Total records" value={formatNumber(records.length)} />
        <AdminStatCard
          label="Matched companies"
          value={formatNumber(records.filter((record) => record.company_id).length)}
          tone="success"
        />
        <AdminStatCard
          label="Unmatched employers"
          value={formatNumber(records.filter((record) => !record.company_id).length)}
          tone="danger"
        />
        <AdminStatCard
          label="Latest import"
          value={importResult ? formatNumber(importResult.processed) : "0"}
          hint={importResult ? "employers processed" : "No import yet this session"}
        />
      </div>

      <AdminPanel
        title="Import USCIS CSV"
        description="Upload a USCIS export and Hireoven will match the rows against tracked companies, refresh sponsorship scores, and leave anything ambiguous for manual review."
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="inline-flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 transition hover:border-sky-400 hover:bg-sky-100">
            <UploadCloud className="h-4 w-4" />
            {uploading ? "Importing..." : "Choose USCIS CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  void handleUpload(file)
                }
                event.currentTarget.value = ""
              }}
            />
          </label>

          {uploading ? (
            <div className="inline-flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Parsing and matching employers
            </div>
          ) : null}
        </div>

        {importResult ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Processed</p>
              <p className="mt-3 text-2xl font-semibold text-gray-900">
                {formatNumber(importResult.processed)}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Matched</p>
              <p className="mt-3 text-2xl font-semibold text-emerald-700">
                {formatNumber(importResult.matched)}
              </p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600">Unmatched</p>
              <p className="mt-3 text-2xl font-semibold text-red-700">
                {formatNumber(importResult.skipped)}
              </p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Scores updated</p>
              <p className="mt-3 text-2xl font-semibold text-sky-800">
                {formatNumber(importResult.scoresUpdated)}
              </p>
            </div>
          </div>
        ) : null}
      </AdminPanel>

      {unmatchedRecords.length > 0 ? (
        <AdminPanel
          title="Unmatched companies"
          description="These employers were imported but could not be confidently matched to a tracked company."
          className="border-red-200"
        >
          <div className="space-y-3">
            {unmatchedRecords.slice(0, 10).map((record) => (
              <div
                key={record.id}
                className="grid gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 lg:grid-cols-[1fr_280px_auto]"
              >
                <div>
                  <p className="font-semibold text-red-900">{record.employer_name}</p>
                  <p className="mt-1 text-sm text-red-700">
                    Year {record.year ?? "Unknown"} · {formatNumber(record.total_petitions)} petitions
                  </p>
                </div>
                <select
                  value={matchDrafts[record.id] ?? ""}
                  onChange={(event) =>
                    setMatchDrafts((current) => ({
                      ...current,
                      [record.id]: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-red-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-red-300"
                >
                  <option value="">Select company</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
                <AdminButton
                  tone="danger"
                  disabled={busyMatchId === record.id}
                  onClick={() => void manuallyMatch(record)}
                >
                  {busyMatchId === record.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Match to company
                </AdminButton>
              </div>
            ))}
          </div>
        </AdminPanel>
      ) : null}

      <AdminPanel
        title="H1B records"
        description="Every imported USCIS employer record, including unmatched rows that still need a human decision."
      >
        <div className="mb-4 grid gap-3 lg:grid-cols-[1.3fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
            <AdminInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employer or matched company"
              className="pl-9"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowUnmatchedOnly((current) => !current)}
            className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
              showUnmatchedOnly
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            Unmatched only
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-3">Employer name</th>
                <th className="px-3 py-3">Matched company</th>
                <th className="px-3 py-3">Year</th>
                <th className="px-3 py-3">Total petitions</th>
                <th className="px-3 py-3">Approvals</th>
                <th className="px-3 py-3">Denial rate</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                    <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
                    Loading H1B records
                  </td>
                </tr>
              ) : visibleRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                    No H1B records match the current filters.
                  </td>
                </tr>
              ) : (
                visibleRecords.map((record) => {
                  const denialRate =
                    record.total_petitions && record.total_petitions > 0
                      ? Math.round(((record.denied ?? 0) / record.total_petitions) * 100)
                      : 0

                  return (
                    <tr key={record.id}>
                      <td className="px-3 py-4 font-medium text-gray-900">{record.employer_name}</td>
                      <td className="px-3 py-4">
                        {record.company ? (
                          <AdminBadge tone="success">{record.company.name}</AdminBadge>
                        ) : (
                          <AdminBadge tone="danger">Unmatched</AdminBadge>
                        )}
                      </td>
                      <td className="px-3 py-4 text-gray-600">{record.year ?? "Unknown"}</td>
                      <td className="px-3 py-4 text-gray-600">
                        {formatNumber(record.total_petitions)}
                      </td>
                      <td className="px-3 py-4 text-gray-600">{formatNumber(record.approved)}</td>
                      <td className="px-3 py-4">
                        <AdminBadge tone={denialRate > 20 ? "danger" : "warning"}>
                          {denialRate}%
                        </AdminBadge>
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={matchDrafts[record.id] ?? ""}
                            onChange={(event) =>
                              setMatchDrafts((current) => ({
                                ...current,
                                [record.id]: event.target.value,
                              }))
                            }
                            className="rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 outline-none"
                          >
                            <option value="">
                              {record.company ? "Remap company" : "Match to company"}
                            </option>
                            {companies.map((company) => (
                              <option key={company.id} value={company.id}>
                                {company.name}
                              </option>
                            ))}
                          </select>
                          <AdminButton
                            tone="secondary"
                            className="px-3 py-2 text-xs"
                            disabled={busyMatchId === record.id}
                            onClick={() => void manuallyMatch(record)}
                          >
                            {busyMatchId === record.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Save match
                          </AdminButton>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>
    </div>
  )
}
