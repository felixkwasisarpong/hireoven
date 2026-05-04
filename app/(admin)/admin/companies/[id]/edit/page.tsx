"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { ArrowLeft, Loader2, RefreshCw, Save } from "lucide-react"
import { useToast } from "@/components/ui/ToastProvider"
import { formatDateTime, formatRelativeTime } from "@/lib/admin/format"
import { cn } from "@/lib/utils"
import type { AtsType, Company, CompanySize, CrawlLog } from "@/types"

const ATS_OPTIONS: AtsType[] = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "bamboohr",
  "icims",
  "custom",
]
const SIZE_OPTIONS: CompanySize[] = ["startup", "small", "medium", "large", "enterprise"]

const LOG_STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  success: { dot: "bg-emerald-500 ring-emerald-100", text: "text-emerald-600" },
  failed: { dot: "bg-red-500 ring-red-100", text: "text-red-600" },
  blocked: { dot: "bg-red-500 ring-red-100", text: "text-red-600" },
  fetch_error: { dot: "bg-red-500 ring-red-100", text: "text-red-600" },
  bad_url: { dot: "bg-amber-400 ring-amber-100", text: "text-amber-600" },
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.25em] text-gray-400">
      {children}
    </p>
  )
}

function FieldLabel({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  )
}

function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/15"
    />
  )
}

function FieldSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/15"
    />
  )
}

export default function EditCompanyPage() {
  const { id } = useParams<{ id: string }>()
  const { pushToast } = useToast()
  const [company, setCompany] = useState<Company | null>(null)
  const [logs, setLogs] = useState<CrawlLog[]>([])
  const [rawConfig, setRawConfig] = useState("{}")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [companyRes, logsRes] = await Promise.all([
        fetch(`/api/companies/${encodeURIComponent(id)}`),
        fetch(`/api/admin/crawl-logs`),
      ])

      if (!companyRes.ok) {
        pushToast({ tone: "error", title: "Unable to load company" })
      } else {
        const { company: typed } = (await companyRes.json()) as { company: Company | null }
        if (typed) {
          setCompany(typed)
          setNotes((typed as Company & { notes?: string }).notes ?? "")
          setRawConfig(JSON.stringify(typed.raw_ats_config ?? {}, null, 2))
        }
        const logsData: CrawlLog[] = logsRes.ok
          ? ((await logsRes.json()) as { crawlLogs: CrawlLog[] }).crawlLogs
              .filter((l) => l.company_id === id)
              .slice(0, 20)
          : []
        setLogs(logsData)
      }
      setLoading(false)
    }
    void load()
  }, [id, pushToast])

  async function saveCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!company) return
    setSaving(true)
    try {
      const parsedConfig = JSON.parse(rawConfig || "{}")
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: company.name,
          domain: company.domain,
          careers_url: company.careers_url,
          ats_type: company.ats_type,
          industry: company.industry,
          size: company.size,
          logo_url: company.logo_url,
          raw_ats_config: parsedConfig,
          is_active: company.is_active,
        }),
      })
      if (!res.ok) throw new Error("Request failed")
      pushToast({ tone: "success", title: "Company updated", description: company.name })
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Unable to save company",
        description: (error as Error).message,
      })
    } finally {
      setSaving(false)
    }
  }

  async function triggerCrawl() {
    if (!company) return
    const res = await fetch("/api/admin/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "company", id: company.id }),
    })
    if (!res.ok) {
      const body = (await res.json()) as { error?: string }
      pushToast({
        tone: "error",
        title: "Unable to trigger crawl",
        description: body.error ?? "Unknown error",
      })
      return
    }
    pushToast({
      tone: "success",
      title: "Crawl started",
      description: `${company.name} has been queued.`,
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading company…</span>
      </div>
    )
  }

  if (!company) {
    return (
      <div className="m-8 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
        Company not found.
      </div>
    )
  }

  return (
    <div>
      {/* ── Company hero ────────────────────────────────────── */}
      <div className="border-b border-gray-100 bg-white px-8 py-5">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-sky-100 to-sky-200 text-lg font-bold text-sky-700">
              {company.logo_url ? (
                <img
                  src={company.logo_url}
                  alt=""
                  className="h-full w-full object-contain"
                />
              ) : (
                company.name.charAt(0).toUpperCase()
              )}
            </div>

            {/* Meta */}
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold tracking-tight text-gray-950">
                  {company.name}
                </h1>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    company.is_active
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-gray-100 text-gray-500"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      company.is_active ? "bg-emerald-500" : "bg-gray-400"
                    )}
                  />
                  {company.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-2 text-sm text-gray-400">
                {company.domain}
                {company.ats_type && (
                  <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {company.ats_type}
                  </span>
                )}
                {company.industry && (
                  <span className="text-gray-300">·</span>
                )}
                {company.industry && (
                  <span className="text-xs text-gray-400">{company.industry}</span>
                )}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <Link
              href="/admin/companies"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500 transition hover:bg-gray-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Link>
            <button
              onClick={() => void triggerCrawl()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500 transition hover:bg-gray-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Force crawl
            </button>
            <Link
              href={`/admin/jobs?company=${company.id}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-800"
            >
              View all jobs
            </Link>
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────── */}
      <div className="grid gap-10 p-8 xl:grid-cols-[1fr_360px]">
        {/* ── Form ──────────────────────────────────────────── */}
        <form onSubmit={saveCompany} className="space-y-8">
          {/* Identity */}
          <div>
            <SectionHeader>Identity</SectionHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Company name">
                <FieldInput
                  value={company.name}
                  onChange={(e) => setCompany((c) => (c ? { ...c, name: e.target.value } : c))}
                />
              </FieldLabel>
              <FieldLabel label="Domain">
                <FieldInput
                  value={company.domain}
                  onChange={(e) => setCompany((c) => (c ? { ...c, domain: e.target.value } : c))}
                />
              </FieldLabel>
              <FieldLabel label="Industry">
                <FieldInput
                  value={company.industry ?? ""}
                  onChange={(e) =>
                    setCompany((c) => (c ? { ...c, industry: e.target.value } : c))
                  }
                  placeholder="e.g. Technology"
                />
              </FieldLabel>
              <FieldLabel label="Logo URL">
                <FieldInput
                  value={company.logo_url ?? ""}
                  onChange={(e) =>
                    setCompany((c) => (c ? { ...c, logo_url: e.target.value } : c))
                  }
                  placeholder="https://…"
                />
              </FieldLabel>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Crawl config */}
          <div>
            <SectionHeader>Crawl configuration</SectionHeader>
            <div className="grid gap-4 sm:grid-cols-3">
              <FieldLabel label="ATS type">
                <FieldSelect
                  value={company.ats_type ?? ""}
                  onChange={(e) =>
                    setCompany((c) =>
                      c ? { ...c, ats_type: (e.target.value || null) as AtsType | null } : c
                    )
                  }
                >
                  <option value="">Select ATS</option>
                  {ATS_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </FieldSelect>
              </FieldLabel>
              <FieldLabel label="ATS identifier">
                <FieldInput
                  value={company.ats_identifier ?? ""}
                  onChange={(e) =>
                    setCompany((c) => (c ? { ...c, ats_identifier: e.target.value } : c))
                  }
                />
              </FieldLabel>
              <FieldLabel label="Company size">
                <FieldSelect
                  value={company.size ?? ""}
                  onChange={(e) =>
                    setCompany((c) =>
                      c ? { ...c, size: (e.target.value || null) as CompanySize | null } : c
                    )
                  }
                >
                  <option value="">Select size</option>
                  {SIZE_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </FieldSelect>
              </FieldLabel>
            </div>
            <div className="mt-4">
              <FieldLabel label="Careers page URL">
                <FieldInput
                  value={company.careers_url}
                  onChange={(e) =>
                    setCompany((c) => (c ? { ...c, careers_url: e.target.value } : c))
                  }
                />
              </FieldLabel>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Notes & raw config */}
          <div>
            <SectionHeader>Notes & raw config</SectionHeader>
            <div className="space-y-4">
              <FieldLabel label="Internal notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Admin-only notes, crawl quirks, manual fixes…"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/15"
                />
              </FieldLabel>
              <FieldLabel label="Raw ATS config (JSON)">
                <textarea
                  value={rawConfig}
                  onChange={(e) => setRawConfig(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 font-mono text-xs text-gray-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/15"
                />
              </FieldLabel>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Active toggle + save */}
          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-3">
              <div className="relative h-5 w-9">
                <input
                  type="checkbox"
                  checked={company.is_active}
                  onChange={(e) =>
                    setCompany((c) => (c ? { ...c, is_active: e.target.checked } : c))
                  }
                  className="peer sr-only"
                />
                <div className="h-5 w-9 rounded-full bg-gray-200 transition-colors peer-checked:bg-sky-600" />
                <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </div>
              <span className="text-sm font-medium text-gray-700">Company is active</span>
            </label>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-800 disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save changes
                </>
              )}
            </button>
          </div>
        </form>

        {/* ── Crawl history timeline ─────────────────────────── */}
        <div>
          <SectionHeader>Crawl history</SectionHeader>
          {logs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 py-14 text-center">
              <p className="text-sm text-gray-400">No crawl logs yet</p>
            </div>
          ) : (
            <div className="relative pl-7">
              {/* Vertical line */}
              <div className="absolute bottom-2 left-3 top-2 w-px bg-gray-100" />

              <div className="space-y-0">
                {logs.map((log) => {
                  const style = LOG_STATUS_STYLE[log.status] ?? {
                    dot: "bg-gray-300 ring-gray-100",
                    text: "text-gray-500",
                  }
                  return (
                    <div key={log.id} className="relative py-3">
                      {/* Timeline dot */}
                      <span
                        className={cn(
                          "absolute -left-4 top-4 h-2.5 w-2.5 rounded-full ring-4",
                          style.dot
                        )}
                      />

                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("text-xs font-semibold", style.text)}>
                              {log.status}
                            </span>
                            {log.new_jobs > 0 && (
                              <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600">
                                +{log.new_jobs} jobs
                              </span>
                            )}
                            {log.duration_ms != null && (
                              <span className="text-[10px] text-gray-400">
                                {log.duration_ms}ms
                              </span>
                            )}
                          </div>
                          {log.error_message && (
                            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-red-500">
                              {log.error_message}
                            </p>
                          )}
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-[10px] font-medium text-gray-500">
                            {formatRelativeTime(log.crawled_at)}
                          </p>
                          <p className="mt-0.5 text-[10px] text-gray-400">
                            {formatDateTime(log.crawled_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
