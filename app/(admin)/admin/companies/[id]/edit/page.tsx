"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { ArrowLeft, Loader2, RefreshCw, Save } from "lucide-react"
import {
  AdminBadge,
  AdminButton,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminSelect,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { formatDateTime, formatRelativeTime } from "@/lib/admin/format"
import { createClient } from "@/lib/supabase/client"
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

export default function EditCompanyPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const { pushToast } = useToast()
  const [company, setCompany] = useState<Company | null>(null)
  const [logs, setLogs] = useState<CrawlLog[]>([])
  const [rawConfig, setRawConfig] = useState("{}")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadCompany() {
      setLoading(true)
      const [{ data: companyData, error: companyError }, { data: logsData, error: logsError }] =
        await Promise.all([
          supabase.from("companies").select("*").eq("id", id).single(),
          supabase
            .from("crawl_logs")
            .select("*")
            .eq("company_id", id)
            .order("crawled_at", { ascending: false })
            .limit(20),
        ])

      if (companyError || logsError) {
        pushToast({
          tone: "error",
          title: "Unable to load company",
          description: companyError?.message ?? logsError?.message ?? "Unknown error",
        })
      } else {
        const typed = companyData as Company
        setCompany(typed)
        setNotes(typed.notes ?? "")
        setRawConfig(JSON.stringify(typed.raw_ats_config ?? {}, null, 2))
        setLogs((logsData ?? []) as CrawlLog[])
      }

      setLoading(false)
    }

    void loadCompany()
  }, [id, pushToast, supabase])

  async function saveCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!company) return

    setSaving(true)

    try {
      const parsedConfig = JSON.parse(rawConfig || "{}")
      const { error } = await ((supabase.from("companies") as any)
        .update({
          name: company.name,
          domain: company.domain,
          careers_url: company.careers_url,
          ats_type: company.ats_type,
          ats_identifier: company.ats_identifier,
          industry: company.industry,
          size: company.size,
          logo_url: company.logo_url,
          notes,
          raw_ats_config: parsedConfig,
          is_active: company.is_active,
        } as any)
        .eq("id", company.id))

      if (error) throw error

      pushToast({
        tone: "success",
        title: "Company updated",
        description: company.name,
      })
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

    const response = await fetch("/api/admin/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "company", id: company.id }),
    })

    if (!response.ok) {
      const body = (await response.json()) as { error?: string }
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
      <div className="flex min-h-[50vh] items-center justify-center text-gray-500">
        <Loader2 className="mr-3 h-5 w-5 animate-spin" />
        Loading company
      </div>
    )
  }

  if (!company) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-700">
        Company not found.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Company edit"
        title={company.name}
        description="Tune ATS config, keep internal notes, review crawl history, and push this company back through the crawler when needed."
        actions={
          <>
            <Link
              href="/admin/companies"
              className="inline-flex items-center rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to companies
            </Link>
            <AdminButton tone="secondary" onClick={() => void triggerCrawl()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Force re-crawl
            </AdminButton>
            <Link
              href={`/admin/jobs?company=${company.id}`}
              className="inline-flex items-center rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              View all jobs
            </Link>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <AdminPanel
          title="Company settings"
          description="Core crawl configuration and admin-only metadata."
        >
          <form className="space-y-5" onSubmit={saveCompany}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-gray-700">
                Company name
                <AdminInput
                  value={company.name}
                  onChange={(event) =>
                    setCompany((current) =>
                      current ? { ...current, name: event.target.value } : current
                    )
                  }
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-700">
                Domain
                <AdminInput
                  value={company.domain}
                  onChange={(event) =>
                    setCompany((current) =>
                      current ? { ...current, domain: event.target.value } : current
                    )
                  }
                />
              </label>
            </div>

            <label className="space-y-2 text-sm font-medium text-gray-700">
              Careers page URL
              <AdminInput
                value={company.careers_url}
                onChange={(event) =>
                  setCompany((current) =>
                    current ? { ...current, careers_url: event.target.value } : current
                  )
                }
              />
            </label>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-sm font-medium text-gray-700">
                ATS type
                <AdminSelect
                  value={company.ats_type ?? ""}
                  onChange={(event) =>
                    setCompany((current) =>
                      current
                        ? { ...current, ats_type: (event.target.value || null) as AtsType | null }
                        : current
                    )
                  }
                >
                  <option value="">Select ATS</option>
                  {ATS_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </AdminSelect>
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-700">
                ATS identifier
                <AdminInput
                  value={company.ats_identifier ?? ""}
                  onChange={(event) =>
                    setCompany((current) =>
                      current ? { ...current, ats_identifier: event.target.value } : current
                    )
                  }
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-700">
                Size
                <AdminSelect
                  value={company.size ?? ""}
                  onChange={(event) =>
                    setCompany((current) =>
                      current
                        ? {
                            ...current,
                            size: (event.target.value || null) as CompanySize | null,
                          }
                        : current
                    )
                  }
                >
                  <option value="">Select size</option>
                  {SIZE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </AdminSelect>
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-gray-700">
                Industry
                <AdminInput
                  value={company.industry ?? ""}
                  onChange={(event) =>
                    setCompany((current) =>
                      current ? { ...current, industry: event.target.value } : current
                    )
                  }
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-700">
                Logo URL
                <AdminInput
                  value={company.logo_url ?? ""}
                  onChange={(event) =>
                    setCompany((current) =>
                      current ? { ...current, logo_url: event.target.value } : current
                    )
                  }
                />
              </label>
            </div>

            <label className="flex items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3">
              <input
                type="checkbox"
                checked={company.is_active}
                onChange={(event) =>
                  setCompany((current) =>
                    current ? { ...current, is_active: event.target.checked } : current
                  )
                }
              />
              <span className="text-sm font-medium text-gray-700">
                Mark company as active
              </span>
            </label>

            <label className="space-y-2 text-sm font-medium text-gray-700">
              Internal notes
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={5}
                className="w-full rounded-2xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
                placeholder="Admin-only notes, crawl quirks, manual fixes..."
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-gray-700">
              Raw ATS config (JSON)
              <textarea
                value={rawConfig}
                onChange={(event) => setRawConfig(event.target.value)}
                rows={10}
                className="w-full rounded-2xl border border-gray-200 px-3 py-2.5 font-mono text-xs text-gray-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
              />
            </label>

            <div className="flex items-center gap-3">
              <AdminButton type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save changes
                  </>
                )}
              </AdminButton>
              <AdminBadge tone={company.is_active ? "success" : "neutral"}>
                {company.is_active ? "Active" : "Inactive"}
              </AdminBadge>
            </div>
          </form>
        </AdminPanel>

        <AdminPanel
          title="Crawl history"
          description="Last 20 crawl logs for this company."
        >
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <AdminBadge
                        tone={
                          log.status === "failed"
                            ? "danger"
                            : log.status === "success"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {log.status}
                      </AdminBadge>
                      <AdminBadge tone="info">+{log.new_jobs} new</AdminBadge>
                      <AdminBadge>{log.duration_ms ?? 0}ms</AdminBadge>
                    </div>
                    {log.error_message ? (
                      <p className="mt-2 text-sm text-red-600">{log.error_message}</p>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>{formatRelativeTime(log.crawled_at)}</p>
                    <p className="mt-1">{formatDateTime(log.crawled_at)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </AdminPanel>
      </div>
    </div>
  )
}
