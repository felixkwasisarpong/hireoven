"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { BellRing, Plus, Trash2, X } from "lucide-react"
import { useAuth } from "@/lib/hooks/useAuth"
import { createClient } from "@/lib/supabase/client"
import type { AlertFrequency, Company, JobAlert, SeniorityLevel } from "@/types"

type AlertDraft = {
  name: string
  keywords: string
  locations: string
  seniority: SeniorityLevel[]
  remoteOnly: boolean
  sponsorshipRequired: boolean
  companyIds: string[]
  frequency: AlertFrequency
}

const SENIORITY_OPTIONS: { value: SeniorityLevel; label: string }[] = [
  { value: "intern", label: "Intern" },
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
  { value: "staff", label: "Staff+" },
]

function parseList(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
}

function buildSummary(alert: JobAlert) {
  const parts: string[] = []
  if (alert.keywords?.length) parts.push(`Keywords: ${alert.keywords.join(", ")}`)
  if (alert.locations?.length) parts.push(`Location: ${alert.locations.join(", ")}`)
  if (alert.seniority_levels?.length)
    parts.push(`Seniority: ${alert.seniority_levels.join(", ")}`)
  if (alert.remote_only) parts.push("Remote only")
  if (alert.sponsorship_required) parts.push("Sponsorship required")
  if (alert.company_ids?.length)
    parts.push(`${alert.company_ids.length} specific compan${alert.company_ids.length === 1 ? "y" : "ies"}`)
  return parts.join(" • ")
}

function formatRelative(timestamp?: string | null) {
  if (!timestamp) return "Never triggered"
  const minutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
  )
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function emptyDraft(frequency: AlertFrequency = "instant"): AlertDraft {
  return {
    name: "",
    keywords: "",
    locations: "",
    seniority: [],
    remoteOnly: false,
    sponsorshipRequired: false,
    companyIds: [],
    frequency,
  }
}

export default function AlertsPage() {
  const { user, profile } = useAuth()
  const [alerts, setAlerts] = useState<JobAlert[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [companySearch, setCompanySearch] = useState("")
  const [draft, setDraft] = useState<AlertDraft>(emptyDraft())

  useEffect(() => {
    async function fetchInitialData() {
      const supabase = createClient()
      const [{ data: alertsData }, { data: companiesData }] = await Promise.all([
        user?.id
          ? supabase
              .from("job_alerts")
              .select("*")
              .eq("user_id", user.id)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        supabase
          .from("companies")
          .select("*")
          .eq("is_active", true)
          .order("job_count", { ascending: false })
          .limit(50),
      ])

      setAlerts((alertsData as JobAlert[]) ?? [])
      setCompanies((companiesData as Company[]) ?? [])
      setDraft(emptyDraft(profile?.alert_frequency ?? "instant"))
      setIsLoading(false)
    }

    void fetchInitialData()
  }, [profile?.alert_frequency, user?.id])

  const visibleCompanies = useMemo(() => {
    if (!companySearch.trim()) return companies.slice(0, 10)
    const query = companySearch.trim().toLowerCase()
    return companies
      .filter(
        (company) =>
          company.name.toLowerCase().includes(query) ||
          (company.industry ?? "").toLowerCase().includes(query)
      )
      .slice(0, 10)
  }, [companies, companySearch])

  async function handleCreateAlert() {
    if (!user?.id) return

    const supabase = createClient()
    const payload = {
      user_id: user.id,
      name: draft.name || null,
      keywords: parseList(draft.keywords),
      locations: parseList(draft.locations),
      seniority_levels: draft.seniority,
      employment_types: [],
      remote_only: draft.remoteOnly,
      sponsorship_required: draft.sponsorshipRequired,
      company_ids: draft.companyIds,
      is_active: true,
    }

    const { data } = await (supabase
      .from("job_alerts")
      .insert(payload as any)
      .select("*")
      .single() as any)

    if (draft.frequency !== profile?.alert_frequency && user.id) {
      await (supabase
        .from("profiles") as any)
        .update({ alert_frequency: draft.frequency } as any)
        .eq("id", user.id)
    }

    if (data) setAlerts((current) => [data as JobAlert, ...current])

    setDraft(emptyDraft(draft.frequency))
    setCompanySearch("")
    setIsModalOpen(false)
  }

  async function toggleAlert(alertId: string, isActive: boolean) {
    setAlerts((current) =>
      current.map((alert) =>
        alert.id === alertId ? { ...alert, is_active: isActive } : alert
      )
    )

    const supabase = createClient()
    await (supabase
      .from("job_alerts") as any)
      .update({ is_active: isActive } as any)
      .eq("id", alertId)
  }

  async function deleteAlert(alertId: string) {
    const snapshot = alerts
    setAlerts((current) => current.filter((alert) => alert.id !== alertId))

    const supabase = createClient()
    const { error } = await supabase.from("job_alerts").delete().eq("id", alertId)
    if (error) setAlerts(snapshot)
  }

  function toggleDraftSeniority(value: SeniorityLevel) {
    setDraft((current) => ({
      ...current,
      seniority: current.seniority.includes(value)
        ? current.seniority.filter((item) => item !== value)
        : [...current.seniority, value],
    }))
  }

  function toggleDraftCompany(companyId: string) {
    setDraft((current) => ({
      ...current,
      companyIds: current.companyIds.includes(companyId)
        ? current.companyIds.filter((item) => item !== companyId)
        : [...current.companyIds, companyId],
    }))
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#F5FBF8_0%,#F8FAFC_58%,#F8FAFC_100%)] px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#1D9E75]">
                Alerts
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
                Saved alerts that keep working for you
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
                Save the search patterns you care about, keep them active in the
                background, and get nudged as new matching roles show up.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                Back to feed
              </Link>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#1D9E75] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#188560]"
              >
                <Plus className="h-4 w-4" />
                Create new alert
              </button>
            </div>
          </div>
        </section>

        {alerts.length === 0 && !isLoading ? (
          <section className="rounded-[32px] border border-dashed border-gray-300 bg-white px-6 py-14 text-center shadow-[0_20px_60px_rgba(15,23,42,0.04)]">
            <BellRing className="mx-auto h-10 w-10 text-[#1D9E75]" />
            <h2 className="mt-4 text-2xl font-semibold text-gray-900">
              No saved alerts yet
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
              Create alerts for your preferred keywords, location, and sponsorship
              filters so the feed keeps hunting even when you are away.
            </p>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[#1D9E75] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#188560]"
            >
              <Plus className="h-4 w-4" />
              Create new alert
            </button>
          </section>
        ) : (
          <section className="space-y-4">
            {alerts.map((alert) => (
              <article
                key={alert.id}
                className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-lg font-semibold text-gray-900">
                        {alert.name || "Untitled alert"}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          alert.is_active
                            ? "bg-[#ECFBF5] text-[#0F6E56]"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {alert.is_active ? "Active" : "Paused"}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-gray-500">
                      {buildSummary(alert)}
                    </p>
                    <p className="text-sm text-gray-500">
                      Last triggered:{" "}
                      <span className="font-medium text-gray-700">
                        {formatRelative(alert.last_triggered_at)}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void toggleAlert(alert.id, !alert.is_active)}
                      className={`rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                        alert.is_active
                          ? "border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                          : "bg-[#ECFBF5] text-[#0F6E56] hover:bg-[#DFF6EC]"
                      }`}
                    >
                      {alert.is_active ? "Pause" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteAlert(alert.id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/30 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[32px] bg-white p-6 shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#1D9E75]">
                  New alert
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-gray-900">
                  Create a fresh search alert
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 text-gray-500 transition hover:bg-gray-50 hover:text-gray-800"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">Alert name</span>
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Fresh backend roles"
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">
                  Keywords
                </span>
                <input
                  value={draft.keywords}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      keywords: event.target.value,
                    }))
                  }
                  placeholder="backend, platform, infra"
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">Location</span>
                <input
                  value={draft.locations}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      locations: event.target.value,
                    }))
                  }
                  placeholder="Remote, Austin, New York"
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
                />
              </label>

              <div className="space-y-2">
                <span className="text-sm font-medium text-gray-700">
                  Notification preference
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: "instant", label: "Instant" },
                    { value: "daily", label: "Daily digest" },
                    { value: "weekly", label: "Weekly" },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          frequency: option.value,
                        }))
                      }
                      className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${
                        draft.frequency === option.value
                          ? "bg-[#ECFBF5] text-[#0F6E56]"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-[28px] border border-gray-200 bg-[#F8FBFA] p-4">
              <p className="text-sm font-medium text-gray-700">Seniority</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SENIORITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleDraftSeniority(option.value)}
                    className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                      draft.seniority.includes(option.value)
                        ? "bg-[#1D9E75] text-white"
                        : "bg-white text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      remoteOnly: !current.remoteOnly,
                    }))
                  }
                  className={`rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
                    draft.remoteOnly
                      ? "border-[#B6E9D8] bg-[#ECFBF5] text-[#0F6E56]"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Remote only
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      sponsorshipRequired: !current.sponsorshipRequired,
                    }))
                  }
                  className={`rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
                    draft.sponsorshipRequired
                      ? "border-[#B6E9D8] bg-[#ECFBF5] text-[#0F6E56]"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Sponsorship required
                </button>
              </div>
            </div>

            <div className="mt-6 rounded-[28px] border border-gray-200 bg-[#F8FBFA] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    Specific companies
                  </p>
                  <p className="text-xs text-gray-500">
                    Optional: narrow this alert to selected employers only
                  </p>
                </div>
                <input
                  value={companySearch}
                  onChange={(event) => setCompanySearch(event.target.value)}
                  placeholder="Search companies…"
                  className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
                />
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {visibleCompanies.map((company) => {
                  const selected = draft.companyIds.includes(company.id)
                  return (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => toggleDraftCompany(company.id)}
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        selected
                          ? "border-[#B6E9D8] bg-[#ECFBF5]"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                    >
                      {company.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={company.logo_url}
                          alt={company.name}
                          className="h-10 w-10 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#E7F5F1] text-sm font-semibold text-[#0F6E56]">
                          {company.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {company.name}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {company.industry || "Company"}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateAlert()}
                className="rounded-2xl bg-[#1D9E75] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#188560]"
              >
                Save alert
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
