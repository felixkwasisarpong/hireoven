"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, RefreshCw, Send, ShieldAlert } from "lucide-react"
import {
  AdminButton,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminSelect,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { createClient } from "@/lib/supabase/client"
import type { SystemSetting } from "@/types"

type SettingsMeta = {
  vapidPublicKey: string
  resendFromName: string
  resendFromEmail: string
  adminEmail: string
}

type VapidPreview = {
  publicKey: string
  privateKey: string
}

function useSettingsMap(rows: SystemSetting[]) {
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<
    string,
    Record<string, unknown>
  >
}

export default function AdminSettingsPage() {
  const supabase = useMemo(() => createClient(), [])
  const { pushToast } = useToast()
  const [rows, setRows] = useState<SystemSetting[]>([])
  const [meta, setMeta] = useState<SettingsMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [generatedVapid, setGeneratedVapid] = useState<VapidPreview | null>(null)

  function setSettingValue(key: string, value: Record<string, unknown>) {
    setRows((current) => {
      const next = [...current]
      const index = next.findIndex((row) => row.key === key)

      if (index === -1) {
        next.push({
          key,
          value,
          updated_at: new Date().toISOString(),
          updated_by: null,
        })
        return next
      }

      next[index] = {
        ...next[index],
        value,
      }
      return next
    })
  }

  async function loadSettings() {
    setLoading(true)
    const [{ data, error }, metaResponse] = await Promise.all([
      supabase.from("system_settings").select("*").order("updated_at", { ascending: false }),
      fetch("/api/admin/settings/meta", { cache: "no-store" }),
    ])

    const metaBody = (await metaResponse.json()) as SettingsMeta & { error?: string }

    if (error || !metaResponse.ok) {
      pushToast({
        tone: "error",
        title: "Unable to load settings",
        description: error?.message ?? metaBody.error ?? "Unknown error",
      })
      setLoading(false)
      return
    }

    setRows((data ?? []) as SystemSetting[])
    setMeta(metaBody)
    setLoading(false)
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  const settingsMap = useSettingsMap(rows)
  const crawlSettings = {
    intervalMinutes: Number(settingsMap.crawl?.intervalMinutes ?? 30),
    maxConcurrentCrawls: Number(settingsMap.crawl?.maxConcurrentCrawls ?? 5),
    paused: Boolean(settingsMap.crawl?.paused),
  }
  const normalizationSettings = {
    enabled: Boolean(settingsMap.normalization?.enabled ?? true),
    model: String(
      settingsMap.normalization?.model ?? "claude-haiku-4-5-20251001"
    ),
  }
  const emailSettings = {
    fromName: String(settingsMap.email?.fromName ?? meta?.resendFromName ?? "Hireoven"),
    fromEmail: String(settingsMap.email?.fromEmail ?? meta?.resendFromEmail ?? ""),
  }

  async function upsertSetting(key: string, value: Record<string, unknown>, successTitle: string) {
    setBusyAction(key)
    const { error } = await ((supabase.from("system_settings") as any).upsert({
      key,
      value,
    } as any))
    setBusyAction(null)

    if (error) {
      pushToast({
        tone: "error",
        title: "Unable to save settings",
        description: error.message,
      })
      return false
    }

    await loadSettings()
    pushToast({
      tone: "success",
      title: successTitle,
    })
    return true
  }

  async function runTest(type: "email" | "push") {
    setBusyAction(type)
    const response = await fetch("/api/admin/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    })
    const body = (await response.json()) as { error?: string }
    setBusyAction(null)

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: `Test ${type} failed`,
        description: body.error ?? "Unknown error",
      })
      return
    }

    pushToast({
      tone: "success",
      title: `Test ${type} sent`,
      description:
        type === "email"
          ? "Check your admin inbox."
          : "Check your browser notifications.",
    })
  }

  async function regenerateVapid() {
    if (
      !window.confirm(
        "Generate a new VAPID key pair? This will not edit .env.local automatically."
      )
    ) {
      return
    }

    setBusyAction("vapid")
    const response = await fetch("/api/admin/settings/vapid", { method: "POST" })
    const body = (await response.json()) as VapidPreview & { error?: string }
    setBusyAction(null)

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Unable to generate VAPID keys",
        description: body.error ?? "Unknown error",
      })
      return
    }

    setGeneratedVapid(body)
    pushToast({
      tone: "success",
      title: "New VAPID keys generated",
      description: "Copy them into your environment before using them in production.",
    })
  }

  async function clearOldLogs() {
    if (!window.confirm("Delete crawl logs older than 30 days?")) return

    setBusyAction("clear-logs")
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const { error } = await supabase.from("crawl_logs").delete().lt("crawled_at", cutoff)
    setBusyAction(null)

    if (error) {
      pushToast({
        tone: "error",
        title: "Unable to clear crawl logs",
        description: error.message,
      })
      return
    }

    pushToast({
      tone: "success",
      title: "Old crawl logs removed",
    })
  }

  async function recrawlAll() {
    if (
      !window.confirm(
        "Run all crawls now? This is the nuclear option and will queue every active company."
      )
    ) {
      return
    }

    setBusyAction("recrawl")
    const response = await fetch("/api/admin/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "all" }),
    })
    const body = (await response.json()) as { error?: string }
    setBusyAction(null)

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Unable to start full crawl",
        description: body.error ?? "Unknown error",
      })
      return
    }

    pushToast({
      tone: "success",
      title: "Full crawl started",
    })
  }

  async function exportAllData() {
    setBusyAction("export")
    const [companies, jobs, profiles, watchlist, jobAlerts, notifications, crawlLogs, h1bRecords, apiUsage, settings] =
      await Promise.all([
        supabase.from("companies").select("*"),
        supabase.from("jobs").select("*"),
        supabase.from("profiles").select("*"),
        supabase.from("watchlist").select("*"),
        supabase.from("job_alerts").select("*"),
        supabase.from("alert_notifications").select("*"),
        supabase.from("crawl_logs").select("*"),
        supabase.from("h1b_records").select("*"),
        supabase.from("api_usage").select("*"),
        supabase.from("system_settings").select("*"),
      ])
    setBusyAction(null)

    const errors = [
      companies.error,
      jobs.error,
      profiles.error,
      watchlist.error,
      jobAlerts.error,
      notifications.error,
      crawlLogs.error,
      h1bRecords.error,
      apiUsage.error,
      settings.error,
    ].filter(Boolean)

    if (errors.length) {
      pushToast({
        tone: "error",
        title: "Export failed",
        description: errors[0]?.message ?? "Unknown error",
      })
      return
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      tables: {
        companies: companies.data ?? [],
        jobs: jobs.data ?? [],
        profiles: profiles.data ?? [],
        watchlist: watchlist.data ?? [],
        job_alerts: jobAlerts.data ?? [],
        alert_notifications: notifications.data ?? [],
        crawl_logs: crawlLogs.data ?? [],
        h1b_records: h1bRecords.data ?? [],
        api_usage: apiUsage.data ?? [],
        system_settings: settings.data ?? [],
      },
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "hireoven-admin-export.json"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    pushToast({
      tone: "success",
      title: "Data export ready",
    })
  }

  if (loading && !rows.length && !meta) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-gray-500">
        <Loader2 className="mr-3 h-5 w-5 animate-spin" />
        Loading admin settings
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Settings"
        title="System configuration"
        description="Tune crawl cadence, notification delivery, and the dangerous system-wide actions that should stay tightly controlled."
      />

      <AdminPanel
        title="Crawl settings"
        description="Core crawler cadence and normalization behavior."
        actions={
          <AdminButton
            tone="secondary"
            disabled={busyAction === "crawl" || busyAction === "normalization"}
            onClick={() =>
              void upsertSetting("crawl", crawlSettings, "Crawl settings saved")
            }
          >
            {busyAction === "crawl" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save crawl settings
          </AdminButton>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <AdminInput
            type="number"
            value={String(crawlSettings.intervalMinutes)}
            onChange={(event) =>
              setSettingValue("crawl", {
                ...crawlSettings,
                intervalMinutes: Number(event.target.value),
              })
            }
            placeholder="Crawl interval minutes"
          />
          <AdminInput
            type="number"
            value={String(crawlSettings.maxConcurrentCrawls)}
            onChange={(event) =>
              setSettingValue("crawl", {
                ...crawlSettings,
                maxConcurrentCrawls: Number(event.target.value),
              })
            }
            placeholder="Max concurrent crawls"
          />
          <AdminSelect
            value={normalizationSettings.model}
            onChange={(event) =>
              setSettingValue("normalization", {
                ...normalizationSettings,
                model: event.target.value,
              })
            }
          >
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</option>
            <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</option>
          </AdminSelect>
          <label className="inline-flex items-center gap-3 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={normalizationSettings.enabled}
              onChange={(event) =>
                setSettingValue("normalization", {
                  ...normalizationSettings,
                  enabled: event.target.checked,
                })
              }
            />
            Enable normalization
          </label>
        </div>
        <div className="mt-4">
          <AdminButton
            tone="secondary"
            disabled={busyAction === "normalization"}
            onClick={() =>
              void upsertSetting(
                "normalization",
                normalizationSettings,
                "Normalization settings saved"
              )
            }
          >
            {busyAction === "normalization" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save normalization settings
          </AdminButton>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Email settings"
        description="Configure outbound email identity and verify delivery from the admin inbox."
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
          <AdminInput
            value={emailSettings.fromName}
            onChange={(event) =>
              setSettingValue("email", {
                ...emailSettings,
                fromName: event.target.value,
              })
            }
            placeholder="From name"
          />
          <AdminInput
            value={emailSettings.fromEmail}
            onChange={(event) =>
              setSettingValue("email", {
                ...emailSettings,
                fromEmail: event.target.value,
              })
            }
            placeholder="From email"
          />
          <div className="flex flex-wrap gap-3">
            <AdminButton
              tone="secondary"
              disabled={busyAction === "email"}
              onClick={() =>
                void upsertSetting("email", emailSettings, "Email settings saved")
              }
            >
              {busyAction === "email" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save
            </AdminButton>
            <AdminButton
              disabled={busyAction === "email"}
              onClick={() => void runTest("email")}
            >
              {busyAction === "email" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Test email
            </AdminButton>
          </div>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Push notification settings"
        description="Inspect the active public key, generate replacement keys, and send a test push to your admin browser."
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
              Active VAPID public key
            </p>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-xs text-gray-700">
              {meta?.vapidPublicKey || "No VAPID public key configured."}
            </pre>
          </div>
          {generatedVapid ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                Newly generated VAPID keys
              </p>
              <p className="mt-2 text-sm text-amber-800">
                These are not written to your environment automatically.
              </p>
              <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-xs text-amber-900">
                {JSON.stringify(generatedVapid, null, 2)}
              </pre>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <AdminButton
              tone="secondary"
              disabled={busyAction === "vapid"}
              onClick={() => void regenerateVapid()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate VAPID keys
            </AdminButton>
            <AdminButton
              disabled={busyAction === "push"}
              onClick={() => void runTest("push")}
            >
              {busyAction === "push" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Test push notification
            </AdminButton>
          </div>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Danger zone"
        description="Irreversible actions that affect the whole system. Every action here should feel heavy."
        className="border-red-200"
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => void clearOldLogs()}
            disabled={busyAction === "clear-logs"}
            className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-left transition hover:bg-red-100"
          >
            {busyAction === "clear-logs" ? (
              <Loader2 className="h-5 w-5 animate-spin text-red-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-red-600" />
            )}
            <p className="mt-4 font-semibold text-red-900">Clear old crawl logs</p>
            <p className="mt-2 text-sm text-red-700">
              Remove crawl logs older than 30 days to keep the table lean.
            </p>
          </button>
          <button
            type="button"
            onClick={() => void recrawlAll()}
            disabled={busyAction === "recrawl"}
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-left transition hover:bg-amber-100"
          >
            {busyAction === "recrawl" ? (
              <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-amber-600" />
            )}
            <p className="mt-4 font-semibold text-amber-900">Re-crawl all companies</p>
            <p className="mt-2 text-sm text-amber-700">
              Queue every active company immediately.
            </p>
          </button>
          <button
            type="button"
            onClick={() => void exportAllData()}
            disabled={busyAction === "export"}
            className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-left transition hover:bg-sky-100"
          >
            {busyAction === "export" ? (
              <Loader2 className="h-5 w-5 animate-spin text-sky-700" />
            ) : (
              <RefreshCw className="h-5 w-5 text-sky-700" />
            )}
            <p className="mt-4 font-semibold text-sky-900">Export all data as JSON</p>
            <p className="mt-2 text-sm text-sky-700">
              Snapshot every operational table for offline inspection.
            </p>
          </button>
        </div>
      </AdminPanel>
    </div>
  )
}
