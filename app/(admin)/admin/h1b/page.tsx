"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Loader2,
  Radar,
  Search,
  Sparkles,
  UploadCloud,
} from "lucide-react"
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
  durationMs?: number
  rowsParsed?: number
}

type LCAImportResult = {
  rowsProcessed: number
  rowsInserted: number
  rowsSkipped: number
  companiesMatched: number
  companiesUnmatched: number
  errors: string[]
  duration: number
}

type ImportPhase =
  | "idle"
  | "upload"
  | "parse"
  | "match"
  | "insert"
  | "upsert-records"
  | "update-companies"
  | "aggregate"
  | "done"

type ProgressEvent = {
  phase: Exclude<ImportPhase, "idle" | "upload">
  processed: number
  total: number
  inserted?: number
  message?: string
}

const PHASE_LABEL: Record<Exclude<ImportPhase, "idle">, string> = {
  upload: "Uploading file",
  parse: "Parsing rows",
  match: "Matching employers to companies",
  insert: "Writing rows to database",
  "upsert-records": "Upserting h1b_records",
  "update-companies": "Refreshing sponsorship scores",
  aggregate: "Rebuilding aggregates",
  done: "Finalising",
}

type EnrichResult = {
  checked: number
  discovered: number
  promoted: number
  stillPending: number
  failed: number
  remaining: number
  sample: Array<{
    id: string
    name: string
    atsType: string | null
    confidence: string | null
    guessedDomain: string | null
    status: "discovered" | "no-match" | "fetch-failed"
  }>
}

function calcConfidence(total1yr: number, approvalRate: number) {
  let score = 0
  if (total1yr > 0) score += 70
  if (approvalRate > 0.8) score += 10
  if (total1yr > 10) score += 10
  if (total1yr > 50) score += 10
  return Math.min(100, score)
}

/** Inline progress bar driven by NDJSON events from the import endpoints. */
function ImportProgressBar({
  progress,
  tone,
  fileName,
  fileSizeBytes,
  elapsedSeconds,
}: {
  progress: ProgressEvent | null
  tone: "sky" | "emerald"
  fileName?: string
  fileSizeBytes?: number
  elapsedSeconds?: number
}) {
  if (!progress) return null

  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : null

  // Indeterminate (pre-parse) bar when we don't yet know the total.
  const indeterminate = pct === null

  const bar = tone === "sky" ? "bg-sky-600" : "bg-emerald-600"
  const track = tone === "sky" ? "bg-sky-100" : "bg-emerald-100"
  const text = tone === "sky" ? "text-sky-800" : "text-emerald-800"

  return (
    <div className="mt-4 space-y-2">
      <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs font-medium ${text}`}>
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="font-semibold">{PHASE_LABEL[progress.phase]}</span>
          {progress.total > 0 ? (
            <span className="text-[11px] text-gray-500">
              {progress.processed.toLocaleString()} / {progress.total.toLocaleString()}
            </span>
          ) : null}
        </span>
        <span className="text-[11px] text-gray-500">
          {pct !== null ? `${pct}%` : "working…"}
          {typeof elapsedSeconds === "number" ? ` · ${elapsedSeconds}s` : ""}
        </span>
      </div>
      <div className={`relative h-2 w-full overflow-hidden rounded-full ${track}`}>
        {indeterminate ? (
          <div
            className={`absolute inset-y-0 left-0 w-1/3 rounded-full ${bar} animate-[shimmer_1.5s_linear_infinite]`}
            style={{
              animation: "shimmer 1.3s ease-in-out infinite",
            }}
          />
        ) : (
          <div
            className={`h-full rounded-full ${bar} transition-all duration-300`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {(fileName || progress.message) ? (
        <div className="flex flex-wrap justify-between gap-x-3 text-[11px] text-gray-500">
          <span className="truncate">{progress.message ?? fileName}</span>
          {fileName && progress.message ? (
            <span className="truncate text-gray-400">{fileName}</span>
          ) : null}
          {typeof fileSizeBytes === "number" ? (
            <span>{(fileSizeBytes / 1024 / 1024).toFixed(2)} MB</span>
          ) : null}
        </div>
      ) : null}
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  )
}

export default function AdminH1BPage() {
  const { pushToast } = useToast()
  const [records, setRecords] = useState<H1BRow[]>([])
  // Unmatched employers are fetched separately from the main records list.
  // `h1b_records` can have hundreds of thousands of rows; Supabase/PostgREST
  // caps a single request at ~1k by default, so we never want to pull the
  // whole table into the browser. Instead we query server-side: only rows
  // with company_id IS NULL and total_petitions >= threshold, ordered by
  // petitions DESC, capped at a small page, plus a separate count query
  // so the summary shows the real "hidden" number, not a 1k-clipped one.
  const [unmatchedList, setUnmatchedList] = useState<H1BRow[]>([])
  const [recordsTotalCount, setRecordsTotalCount] = useState(0)
  const [unmatchedTotalAll, setUnmatchedTotalAll] = useState(0)
  const [unmatchedTotalAtThreshold, setUnmatchedTotalAtThreshold] = useState(0)
  const [unmatchedLoading, setUnmatchedLoading] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadElapsed, setUploadElapsed] = useState(0)
  const [uploadFile, setUploadFile] = useState<{ name: string; size: number } | null>(null)
  const [search, setSearch] = useState("")
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false)
  // Unmatched list threshold: only show employers with at least this many
  // petitions. The USCIS + LCA long tail is thousands of one-off employers
  // that aren't worth a company row; surface only the ones that matter.
  const [unmatchedMinPetitions, setUnmatchedMinPetitions] = useState(25)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [matchDrafts, setMatchDrafts] = useState<Record<string, string>>({})
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null)
  const [lcaUploading, setLCAUploading] = useState(false)
  const [lcaResult, setLCAResult] = useState<LCAImportResult | null>(null)
  const [lcaFiscalYear, setLCAFiscalYear] = useState<string>("")
  const [uscisProgress, setUscisProgress] = useState<ProgressEvent | null>(null)
  const [lcaProgress, setLCAProgress] = useState<ProgressEvent | null>(null)
  const [enrichPending, setEnrichPending] = useState<number | null>(null)
  const [enrichRunning, setEnrichRunning] = useState(false)
  const [enrichCumulative, setEnrichCumulative] = useState<EnrichResult | null>(null)

  async function loadData() {
    setLoading(true)
    const [recordsRes, companiesRes] = await Promise.all([
      fetch("/api/admin/h1b"),
      fetch("/api/admin/companies"),
    ])

    if (!recordsRes.ok || !companiesRes.ok) {
      pushToast({ tone: "error", title: "Unable to load H1B data" })
      setLoading(false)
      return
    }

    const { records: recordsData } = (await recordsRes.json()) as { records: H1BRow[] }
    const { companies: companiesData } = (await companiesRes.json()) as { companies: Company[] }
    setRecords(recordsData ?? [])
    setCompanies(companiesData ?? [])
    setLoading(false)
  }

  // Fetch the unmatched-employers slice from Postgres. We run three queries:
  //   1. total unmatched (head-only count) - how big the backlog actually is
  //   2. total unmatched at/above threshold (head-only count) - "showing X of Y"
  //   3. the top `pageSize` rows at/above threshold, ordered by petitions DESC
  // This keeps the payload tiny (≤ pageSize rows) even when h1b_records has
  // hundreds of thousands of entries.
  const UNMATCHED_PAGE_SIZE = 25
  async function loadUnmatched(minPetitions: number, searchTerm: string) {
    setUnmatchedLoading(true)
    const params = new URLSearchParams({
      mode: "unmatched",
      minPetitions: String(minPetitions),
      limit: String(UNMATCHED_PAGE_SIZE),
    })
    if (searchTerm.trim()) params.set("q", searchTerm.trim())

    const res = await fetch(`/api/admin/h1b?${params}`)
    if (!res.ok) {
      pushToast({ tone: "error", title: "Unable to load unmatched employers" })
      setUnmatchedLoading(false)
      return
    }

    const data = (await res.json()) as {
      grandTotal: number
      unmatchedTotal: number
      atThresholdCount: number
      records: H1BRow[]
    }
    setRecordsTotalCount(data.grandTotal)
    setUnmatchedTotalAll(data.unmatchedTotal)
    setUnmatchedTotalAtThreshold(data.atThresholdCount)
    setUnmatchedList(data.records)
    setUnmatchedLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadUnmatched(unmatchedMinPetitions, search)
    }, 250)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unmatchedMinPetitions, search])

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

  const unmatchedHiddenCount = Math.max(
    0,
    unmatchedTotalAll - unmatchedTotalAtThreshold
  )

  /**
   * Consume an NDJSON stream from an import endpoint. Each line is parsed
   * as a JSON object with a `type` discriminator:
   *   - progress → forwarded to `onProgress`
   *   - result   → forwarded to `onResult`
   *   - error    → forwarded to `onError`
   */
  async function consumeImportStream(
    response: Response,
    handlers: {
      onProgress: (p: ProgressEvent) => void
      onResult: (r: Record<string, unknown>) => void
      onError: (message: string) => void
    }
  ) {
    if (!response.body) {
      handlers.onError("Server returned no response body")
      return
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let newlineIdx = buf.indexOf("\n")
        while (newlineIdx !== -1) {
          const line = buf.slice(0, newlineIdx).trim()
          buf = buf.slice(newlineIdx + 1)
          if (line) {
            try {
              const evt = JSON.parse(line) as
                | ({ type: "progress" } & ProgressEvent)
                | ({ type: "result" } & Record<string, unknown>)
                | { type: "error"; error: string }
              if (evt.type === "progress") {
                handlers.onProgress(evt)
              } else if (evt.type === "result") {
                handlers.onResult(evt)
              } else if (evt.type === "error") {
                handlers.onError(evt.error)
              }
            } catch {
              // Ignore malformed lines - the server should not emit them,
              // but we don't want a stray log line to kill the stream.
            }
          }
          newlineIdx = buf.indexOf("\n")
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setImportResult(null)
    setUscisProgress({ phase: "parse", processed: 0, total: 0 })
    setUploadFile({ name: file.name, size: file.size })
    setUploadElapsed(0)
    const started = Date.now()
    const ticker = setInterval(() => {
      setUploadElapsed(Math.round((Date.now() - started) / 1000))
    }, 1000)

    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch("/api/h1b/import", {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        pushToast({
          tone: "error",
          title: `Import failed (HTTP ${response.status})`,
          description: text.slice(0, 500) || "Unknown error",
        })
        return
      }

      let errored = false
      await consumeImportStream(response, {
        onProgress: (p) => setUscisProgress(p),
        onResult: (body) => {
          const typed = body as Partial<ImportResult>
          setImportResult({
            processed: typed.processed ?? 0,
            matched: typed.matched ?? 0,
            skipped: typed.skipped ?? 0,
            scoresUpdated: typed.scoresUpdated ?? 0,
            unmatchedEmployers: typed.unmatchedEmployers ?? [],
            durationMs: typed.durationMs,
            rowsParsed: typed.rowsParsed,
          })
          pushToast({
            tone: "success",
            title: "USCIS import complete",
            description: `${formatNumber(typed.processed ?? 0)} employer-years processed in ${Math.round((typed.durationMs ?? (Date.now() - started)) / 1000)}s.`,
          })
        },
        onError: (message) => {
          errored = true
          pushToast({ tone: "error", title: "USCIS import failed", description: message })
        },
      })
      if (!errored) await loadData()
    } catch (err) {
      pushToast({
        tone: "error",
        title: "Import request failed",
        description: (err as Error).message ?? "Network error - check the server logs.",
      })
    } finally {
      clearInterval(ticker)
      setUploading(false)
      setUscisProgress(null)
    }
  }

  async function handleLCAUpload(file: File) {
    setLCAUploading(true)
    setLCAResult(null)
    setLCAProgress({ phase: "parse", processed: 0, total: 0 })

    const formData = new FormData()
    formData.append("file", file)
    if (lcaFiscalYear.trim() !== "") {
      formData.append("fiscalYear", lcaFiscalYear.trim())
    }

    try {
      const response = await fetch("/api/h1b/import-lca", {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        pushToast({
          tone: "error",
          title: `LCA import failed (HTTP ${response.status})`,
          description: text.slice(0, 500) || "Unknown error",
        })
        return
      }

      await consumeImportStream(response, {
        onProgress: (p) => setLCAProgress(p),
        onResult: (body) => {
          const typed = body as Partial<LCAImportResult>
          setLCAResult({
            rowsProcessed: typed.rowsProcessed ?? 0,
            rowsInserted: typed.rowsInserted ?? 0,
            rowsSkipped: typed.rowsSkipped ?? 0,
            companiesMatched: typed.companiesMatched ?? 0,
            companiesUnmatched: typed.companiesUnmatched ?? 0,
            errors: typed.errors ?? [],
            duration: typed.duration ?? 0,
          })
          pushToast({
            tone: "success",
            title: "LCA import complete",
            description: `${formatNumber(typed.rowsInserted ?? 0)} rows imported in ${Math.round((typed.duration ?? 0) / 1000)}s.`,
          })
        },
        onError: (message) => {
          pushToast({ tone: "error", title: "LCA import failed", description: message })
        },
      })
      await refreshEnrichPending()
    } catch (err) {
      pushToast({
        tone: "error",
        title: "LCA import request failed",
        description: (err as Error).message ?? "Network error - check the server logs.",
      })
    } finally {
      setLCAUploading(false)
      setLCAProgress(null)
    }
  }

  const refreshEnrichPending = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/h1b/enrich-placeholders")
      if (!response.ok) return
      const body = (await response.json()) as { remaining?: number }
      setEnrichPending(body.remaining ?? 0)
    } catch {
      // silent - the button will just render without a count
    }
  }, [])

  useEffect(() => {
    void refreshEnrichPending()
  }, [refreshEnrichPending])

  async function runEnrichment(limit = 25) {
    setEnrichRunning(true)
    try {
      const response = await fetch("/api/admin/h1b/enrich-placeholders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit }),
      })
      const body = (await response.json()) as { error?: string } & Partial<EnrichResult>
      if (!response.ok) {
        pushToast({
          tone: "error",
          title: "Enrichment failed",
          description: body.error ?? "Unknown error",
        })
        return
      }
      setEnrichCumulative((prev) => {
        const next: EnrichResult = {
          checked: (prev?.checked ?? 0) + (body.checked ?? 0),
          discovered: (prev?.discovered ?? 0) + (body.discovered ?? 0),
          promoted: (prev?.promoted ?? 0) + (body.promoted ?? 0),
          stillPending: (prev?.stillPending ?? 0) + (body.stillPending ?? 0),
          failed: (prev?.failed ?? 0) + (body.failed ?? 0),
          remaining: body.remaining ?? 0,
          sample: [...(body.sample ?? []), ...(prev?.sample ?? [])].slice(0, 25),
        }
        return next
      })
      setEnrichPending(body.remaining ?? 0)
      pushToast({
        tone: "success",
        title: `Checked ${body.checked ?? 0} placeholder${(body.checked ?? 0) === 1 ? "" : "s"}`,
        description: `${body.discovered ?? 0} ATS discovered · ${body.promoted ?? 0} promoted to active.`,
      })
      await loadData()
    } finally {
      setEnrichRunning(false)
    }
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

    const matchRes = await fetch("/api/admin/h1b", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordId: record.id,
        companyId,
        sponsorCount: record.approved ?? 0,
        sponsorsH1b: (record.approved ?? 0) > 0,
        sponsorshipConfidence: calcConfidence(record.approved ?? 0, approvalRate),
      }),
    })
    setBusyMatchId(null)

    if (!matchRes.ok) {
      pushToast({
        tone: "error",
        title: "Manual match failed",
        description: "Request failed",
      })
      return
    }

    pushToast({
      tone: "success",
      title: "Company matched",
      description: `${record.employer_name} now maps to ${selectedCompany.name}.`,
    })
    await Promise.all([loadData(), loadUnmatched(unmatchedMinPetitions, search)])
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="H1B data"
        title="USCIS sponsorship operations"
        description="Import petition data, inspect which employers still need manual mapping, and keep company sponsorship scores grounded in real USCIS history."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Total records"
          value={formatNumber(recordsTotalCount)}
          hint="rows in h1b_records"
        />
        <AdminStatCard
          label="Matched companies"
          value={formatNumber(
            Math.max(0, recordsTotalCount - unmatchedTotalAll)
          )}
          tone="success"
        />
        <AdminStatCard
          label="Unmatched employers"
          value={formatNumber(unmatchedTotalAll)}
          tone="danger"
          hint={`${formatNumber(unmatchedTotalAtThreshold)} ≥ ${unmatchedMinPetitions} petitions`}
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
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
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

        </div>

        <ImportProgressBar
          progress={uscisProgress}
          tone="sky"
          fileName={uploadFile?.name}
          fileSizeBytes={uploadFile?.size}
          elapsedSeconds={uploading ? uploadElapsed : undefined}
        />

        {importResult ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Employer-years</p>
              <p className="mt-3 text-2xl font-semibold text-gray-900">
                {formatNumber(importResult.processed)}
              </p>
              {importResult.rowsParsed ? (
                <p className="mt-1 text-[11px] text-gray-500">
                  from {formatNumber(importResult.rowsParsed)} raw rows
                </p>
              ) : null}
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
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Duration</p>
              <p className="mt-3 text-2xl font-semibold text-gray-900">
                {importResult.durationMs
                  ? `${(importResult.durationMs / 1000).toFixed(1)}s`
                  : "-"}
              </p>
            </div>
          </div>
        ) : null}
      </AdminPanel>

      <AdminPanel
        title="Import DOL LCA disclosure"
        description="Upload a DOL LCA quarterly disclosure - .xlsx, .xls, .csv, or .tsv. Rows are loaded into lca_records only; no companies are created here. Run the reconciliation script after import to promote unmatched employers into placeholder companies."
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_220px] lg:items-end">
          <label className="inline-flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-100">
            <UploadCloud className="h-4 w-4" />
            {lcaUploading ? "Importing..." : "Choose DOL LCA file"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/tab-separated-values,text/plain"
              className="hidden"
              disabled={lcaUploading}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  void handleLCAUpload(file)
                }
                event.currentTarget.value = ""
              }}
            />
          </label>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
              Fiscal year (optional)
            </label>
            <AdminInput
              value={lcaFiscalYear}
              onChange={(event) => setLCAFiscalYear(event.target.value)}
              placeholder="e.g. 2025"
              inputMode="numeric"
              disabled={lcaUploading}
            />
          </div>
        </div>

        <ImportProgressBar progress={lcaProgress} tone="emerald" />

        {lcaResult ? (
          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                Rows processed
              </p>
              <p className="mt-3 text-2xl font-semibold text-gray-900">
                {formatNumber(lcaResult.rowsProcessed)}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">
                Rows inserted
              </p>
              <p className="mt-3 text-2xl font-semibold text-emerald-700">
                {formatNumber(lcaResult.rowsInserted)}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
                Rows skipped
              </p>
              <p className="mt-3 text-2xl font-semibold text-amber-800">
                {formatNumber(lcaResult.rowsSkipped)}
              </p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                Matched existing
              </p>
              <p className="mt-3 text-2xl font-semibold text-sky-800">
                {formatNumber(lcaResult.companiesMatched)}
              </p>
              <p className="mt-1 text-[11px] text-sky-700/70">
                employers linked to known companies
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                Duration
              </p>
              <p className="mt-3 text-2xl font-semibold text-gray-900">
                {Math.round(lcaResult.duration / 1000)}s
              </p>
            </div>
          </div>
        ) : null}

        {lcaResult && lcaResult.errors.length > 0 ? (() => {
          // Informational lines (parsed sheet / header row) vs real warnings.
          const info = lcaResult.errors.filter((m) => /^Parsed sheet\b/i.test(m))
          const warnings = lcaResult.errors.filter((m) => !/^Parsed sheet\b/i.test(m))
          return (
            <div className="mt-4 space-y-3">
              {info.length > 0 ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">
                    Parser details
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
                    {info.map((message, idx) => (
                      <li key={idx}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {warnings.length > 0 ? (
                <details className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  <summary className="cursor-pointer font-semibold">
                    {warnings.length} warning{warnings.length === 1 ? "" : "s"} during import
                  </summary>
                  <ul className="mt-3 list-inside list-disc space-y-1 text-xs">
                    {warnings.slice(0, 25).map((message, idx) => (
                      <li key={idx}>{message}</li>
                    ))}
                    {warnings.length > 25 ? (
                      <li className="italic">...and {warnings.length - 25} more.</li>
                    ) : null}
                  </ul>
                </details>
              ) : null}
            </div>
          )
        })() : null}

        {lcaResult && lcaResult.rowsProcessed === 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">
              No data rows were detected in this workbook.
            </p>
            <p className="mt-2 text-xs">
              The parser scans each sheet for a header row containing
              <code className="mx-1 rounded bg-white px-1 py-0.5">EMPLOYER_NAME</code>
              /
              <code className="mx-1 rounded bg-white px-1 py-0.5">CASE_NUMBER</code>
              /
              <code className="mx-1 rounded bg-white px-1 py-0.5">CASE_STATUS</code>.
              If your file uses non-standard column names or a different first sheet,
              open it in Excel and confirm the header row contains those tokens, or share the sheet name and I&apos;ll extend the alias list.
            </p>
          </div>
        ) : null}
      </AdminPanel>

      {(lcaResult || importResult || (enrichPending !== null && enrichPending > 0)) ? (
        <AdminPanel
          title="Continue from here"
          description="Imports load raw USCIS / LCA rows only - the companies table is untouched. The steps below are optional; skip them if you don't want new companies created right now."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">
                Reconcile companies (optional)
              </div>
              <p className="mt-3 text-sm text-amber-900/90">
                Only run this when you&apos;re ready to promote heavy-filing
                employers into <code className="rounded bg-white/70 px-1">companies</code> rows.
                Defaults are strict so you don&apos;t flood the table - the
                long tail stays in raw import tables with{" "}
                <code className="rounded bg-white/70 px-1">company_id = null</code>.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-white/70 p-3 text-xs text-amber-900">
{`# preview (dry-run prints N would-create and top 25)\nnpm run db:reconcile-from-imports\n\n# commit - back-links lca/h1b/employer_lca_stats rows\nnpm run db:reconcile-from-imports:execute\n\n# stricter / capped variants\nnpx tsx scripts/reconcile-companies-from-imports.ts \\\n  --lca-threshold=500 --uscis-threshold=200 --limit=250 --execute`}
              </pre>
              <p className="mt-2 text-[11px] text-amber-700/80">
                Defaults: lca ≥ 100 filings OR uscis ≥ 50 approvals. You can
                come back to this (and <code>npm run db:prune-low-signal</code>)
                whenever.
              </p>
            </div>

            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-700">
                <Radar className="h-4 w-4" />
                Discover ATS
              </div>
              <p className="mt-3 text-3xl font-semibold text-indigo-900">
                {enrichPending === null ? "-" : formatNumber(enrichPending)}
              </p>
              <p className="mt-1 text-xs text-indigo-700/80">
                placeholder companies awaiting ATS discovery
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <AdminButton
                  disabled={enrichRunning || (enrichPending ?? 0) === 0}
                  onClick={() => void runEnrichment(25)}
                >
                  {enrichRunning ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Discovering…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Discover next 25
                    </>
                  )}
                </AdminButton>
                <AdminButton
                  tone="secondary"
                  disabled={enrichRunning || (enrichPending ?? 0) === 0}
                  onClick={() => void runEnrichment(100)}
                >
                  Run 100
                </AdminButton>
              </div>

              {enrichCumulative ? (
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-indigo-900/80">
                  <div>Checked {formatNumber(enrichCumulative.checked)}</div>
                  <div>ATS found {formatNumber(enrichCumulative.discovered)}</div>
                  <div>Promoted {formatNumber(enrichCumulative.promoted)}</div>
                  <div>Still inactive {formatNumber(enrichCumulative.stillPending)}</div>
                  <div>No match {formatNumber(enrichCumulative.failed)}</div>
                  <div>Remaining {formatNumber(enrichCumulative.remaining)}</div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
                Explore the data
              </div>
              <ul className="mt-3 space-y-2 text-sm text-emerald-900">
                <li>
                  <Link
                    href="/dashboard/international/h1b-explorer"
                    className="inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    H1B explorer <ArrowRight className="h-3 w-3" />
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/companies?filter=inactive"
                    className="inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    Inactive companies <ArrowRight className="h-3 w-3" />
                  </Link>
                </li>
                <li>
                  Unmatched USCIS records are listed below - match them to a
                  tracked company to fuse approval data with existing
                  sponsorship scores.
                </li>
              </ul>
            </div>
          </div>

          {enrichCumulative && enrichCumulative.sample.length > 0 ? (
            <div className="mt-6">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                Latest discovery results
              </div>
              <div className="overflow-x-auto rounded-2xl border border-gray-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-[0.2em] text-gray-400">
                    <tr>
                      <th className="px-4 py-2">Company</th>
                      <th className="px-4 py-2">ATS</th>
                      <th className="px-4 py-2">Domain</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {enrichCumulative.sample.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2 font-medium text-gray-900">
                          {row.name}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {row.atsType ? (
                            <AdminBadge tone={row.confidence === "high" ? "success" : "warning"}>
                              {row.atsType}
                            </AdminBadge>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {row.guessedDomain ?? (
                            <span className="text-gray-400">(none)</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <AdminBadge
                            tone={
                              row.status === "discovered"
                                ? "success"
                                : row.status === "no-match"
                                  ? "warning"
                                  : "danger"
                            }
                          >
                            {row.status}
                          </AdminBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </AdminPanel>
      ) : null}

      {unmatchedTotalAll > 0 ? (
        <AdminPanel
          title="High-signal unmatched employers"
          description="Only employers at or above the threshold below are shown here. The long tail of one-off employers is intentionally hidden - trying to match them manually isn't worth it. Run the reconciliation script to bulk-create placeholder companies for big employers, or manually match the ones worth tracking below."
          className="border-red-200"
        >
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[220px]">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-red-800">
                Minimum petitions
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={500}
                  step={1}
                  value={unmatchedMinPetitions}
                  onChange={(event) =>
                    setUnmatchedMinPetitions(Number(event.target.value))
                  }
                  className="flex-1 accent-red-600"
                />
                <AdminInput
                  type="number"
                  min={1}
                  value={unmatchedMinPetitions}
                  onChange={(event) =>
                    setUnmatchedMinPetitions(Math.max(1, Number(event.target.value) || 1))
                  }
                  className="w-24"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {[10, 25, 50, 100, 250].map((threshold) => (
                <button
                  key={threshold}
                  type="button"
                  onClick={() => setUnmatchedMinPetitions(threshold)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    unmatchedMinPetitions === threshold
                      ? "border-red-600 bg-red-600 text-white"
                      : "border-red-200 bg-white text-red-700 hover:bg-red-50"
                  }`}
                >
                  ≥ {threshold}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-4 rounded-2xl bg-red-50/60 px-4 py-3 text-sm text-red-800">
            {unmatchedLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Counting unmatched employers…
              </span>
            ) : (
              <>
                Showing up to{" "}
                <strong>{formatNumber(Math.min(unmatchedList.length, 25))}</strong> of{" "}
                <strong>{formatNumber(unmatchedTotalAtThreshold)}</strong> unmatched
                employers ≥ {unmatchedMinPetitions} petitions · hiding{" "}
                <strong>{formatNumber(unmatchedHiddenCount)}</strong> below the
                threshold (total unmatched:{" "}
                <strong>{formatNumber(unmatchedTotalAll)}</strong>).
              </>
            )}
          </div>
          {unmatchedList.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-red-200 bg-white px-4 py-6 text-center text-sm text-red-700">
              No unmatched employers at or above {unmatchedMinPetitions} petitions.
              Lower the threshold, or let the reconciliation script handle the long
              tail.
            </p>
          ) : (
            <div className="space-y-3">
              {unmatchedList.map((record) => (
                <div
                  key={record.id}
                  className="grid gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 lg:grid-cols-[1fr_280px_auto]"
                >
                  <div>
                    <p className="font-semibold text-red-900">{record.employer_name}</p>
                    <p className="mt-1 text-sm text-red-700">
                      Year {record.year ?? "Unknown"} ·{" "}
                      {formatNumber(record.total_petitions)} petitions
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
              {unmatchedTotalAtThreshold > unmatchedList.length ? (
                <p className="pt-2 text-center text-xs text-red-700">
                  Showing top {formatNumber(unmatchedList.length)} by petition count.
                  Raise the threshold or match a few and the next batch will surface.
                </p>
              ) : null}
            </div>
          )}
        </AdminPanel>
      ) : null}

      <AdminPanel
        title="H1B records (most recent 1,000)"
        description={`A live sample of the most recent imports (PostgREST default cap). Total rows in h1b_records: ${formatNumber(recordsTotalCount)}. Use search to narrow, or use the unmatched panel above for high-signal manual matching.`}
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
