"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Download,
  Loader2,
  Mail,
  Radar,
  Radio,
  RefreshCw,
  ScrollText,
  Send,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react"
import {
  AdminButton,
  AdminInput,
  AdminSelect,
  AdminBadge,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { ANTHROPIC_MODEL_OPTIONS, DEFAULT_HAIKU_MODEL } from "@/lib/ai/anthropic-model-defaults"
import { cn } from "@/lib/utils"
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

type SectionAccent = "ocean" | "aurora" | "royal" | "blaze" | "danger"

const THEME: Record<
  SectionAccent,
  {
    outer: string
    header: string
    icon: string
    eyebrow: string
    title: string
    content: string
  }
> = {
  ocean: {
    outer:
      "bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-700 p-[2px] shadow-[0_22px_55px_-14px_rgba(14,165,233,0.55)]",
    header:
      "border-b border-cyan-300/40 bg-gradient-to-r from-cyan-200/90 via-sky-100/70 to-white",
    icon: "bg-gradient-to-br from-cyan-300 to-blue-700 text-white shadow-xl shadow-blue-700/45 ring-2 ring-white/80",
    eyebrow: "font-extrabold text-cyan-800",
    title: "text-slate-900",
    content: "bg-gradient-to-b from-white via-cyan-50/40 to-sky-100/30",
  },
  aurora: {
    outer:
      "bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-600 p-[2px] shadow-[0_22px_55px_-14px_rgba(192,38,211,0.5)]",
    header:
      "border-b border-fuchsia-300/40 bg-gradient-to-r from-violet-100/95 via-fuchsia-50/80 to-purple-50/50",
    icon: "bg-gradient-to-br from-violet-400 to-fuchsia-700 text-white shadow-xl shadow-purple-700/45 ring-2 ring-white/80",
    eyebrow: "font-extrabold text-fuchsia-800",
    title: "text-slate-900",
    content: "bg-gradient-to-b from-white via-violet-50/35 to-fuchsia-50/25",
  },
  royal: {
    outer:
      "bg-gradient-to-br from-indigo-500 via-blue-600 to-violet-800 p-[2px] shadow-[0_22px_55px_-14px_rgba(79,70,229,0.45)]",
    header:
      "border-b border-indigo-200/50 bg-gradient-to-r from-indigo-100/95 via-blue-50/80 to-white",
    icon: "bg-gradient-to-br from-indigo-400 to-violet-900 text-white shadow-xl shadow-indigo-900/40 ring-2 ring-white/80",
    eyebrow: "font-extrabold text-indigo-800",
    title: "text-slate-900",
    content: "bg-gradient-to-b from-white via-indigo-50/30 to-blue-50/35",
  },
  blaze: {
    outer:
      "bg-gradient-to-br from-[#fb923c] via-orange-500 to-red-600 p-[2px] shadow-[0_22px_55px_-14px_rgba(234,88,12,0.5)]",
    header:
      "border-b border-orange-200/60 bg-gradient-to-r from-orange-100/95 via-amber-50/85 to-orange-50/60",
    icon: "bg-gradient-to-br from-orange-400 to-red-700 text-white shadow-xl shadow-orange-700/45 ring-2 ring-white/80",
    eyebrow: "font-extrabold text-orange-900",
    title: "text-slate-900",
    content: "bg-gradient-to-b from-white via-orange-50/45 to-amber-50/40",
  },
  danger: {
    outer:
      "bg-gradient-to-br from-rose-500 via-red-600 to-red-950 p-[2px] shadow-[0_24px_60px_-12px_rgba(220,38,38,0.55)]",
    header:
      "border-b border-red-300/50 bg-gradient-to-r from-red-200/90 via-rose-100/80 to-white",
    icon: "bg-gradient-to-br from-rose-400 to-red-950 text-white shadow-xl shadow-red-900/50 ring-2 ring-white/80",
    eyebrow: "font-extrabold text-red-800",
    title: "text-slate-900",
    content: "bg-gradient-to-b from-white via-rose-50/50 to-red-50/35",
  },
}

const SETTINGS_NAV: { href: string; label: string; chip: string }[] = [
  {
    href: "#crawler",
    label: "Crawler",
    chip:
      "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/35 hover:brightness-110 hover:shadow-cyan-500/50",
  },
  {
    href: "#ai",
    label: "AI",
    chip:
      "bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-fuchsia-500/35 hover:brightness-110",
  },
  {
    href: "#email",
    label: "Email",
    chip:
      "bg-gradient-to-r from-indigo-500 to-blue-700 text-white shadow-lg shadow-indigo-500/35 hover:brightness-110",
  },
  {
    href: "#push",
    label: "Push",
    chip:
      "bg-gradient-to-r from-orange-500 to-red-600 text-white shadow-lg shadow-orange-500/40 hover:brightness-110",
  },
  {
    href: "#danger",
    label: "Danger",
    chip:
      "bg-gradient-to-r from-rose-600 to-red-900 text-white shadow-lg shadow-rose-600/40 hover:brightness-110",
  },
]

function useSettingsMap(rows: SystemSetting[]) {
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<
    string,
    Record<string, unknown>
  >
}

function SettingField({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={htmlFor} className="text-[13px] font-bold tracking-tight text-slate-900">
          {label}
        </label>
        {hint ? <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{hint}</p> : null}
      </div>
      {children}
    </div>
  )
}

function SettingsSection({
  id,
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
  children,
  accent,
}: {
  id: string
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  accent: SectionAccent
}) {
  const t = THEME[accent]
  return (
    <section id={id} className={cn("scroll-mt-28 overflow-hidden rounded-[22px]", t.outer)}>
      <div className="overflow-hidden rounded-[20px] bg-white">
        <div
          className={cn(
            "flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start sm:justify-between",
            t.header
          )}
        >
          <div className="flex gap-4">
            <span
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                t.icon
              )}
            >
              <Icon className="h-6 w-6" aria-hidden strokeWidth={2.25} />
            </span>
            <div>
              {eyebrow ? (
                <p className={cn("text-[10px] uppercase tracking-[0.28em]", t.eyebrow)}>{eyebrow}</p>
              ) : null}
              <h2 className={cn("text-lg font-bold tracking-tight", t.title)}>{title}</h2>
              {description ? (
                <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-slate-700">{description}</p>
              ) : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{actions}</div> : null}
        </div>
        <div className={cn("px-6 py-6", t.content)}>{children}</div>
      </div>
    </section>
  )
}

export default function AdminSettingsPage() {
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
    const [settingsRes, metaResponse] = await Promise.all([
      fetch("/api/admin/system-settings"),
      fetch("/api/admin/settings/meta", { cache: "no-store" }),
    ])

    const metaBody = (await metaResponse.json()) as SettingsMeta & { error?: string }

    if (!settingsRes.ok || !metaResponse.ok) {
      pushToast({
        tone: "error",
        title: "Unable to load settings",
        description: metaBody.error ?? "Unknown error",
      })
      setLoading(false)
      return
    }

    const { settings } = (await settingsRes.json()) as { settings: SystemSetting[] }
    setRows(settings ?? [])
    setMeta(metaBody)
    setLoading(false)
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  const settingsMap = useSettingsMap(rows)
  const crawlSettings = useMemo(
    () => ({
      intervalMinutes: Number(settingsMap.crawl?.intervalMinutes ?? 30),
      maxConcurrentCrawls: Number(settingsMap.crawl?.maxConcurrentCrawls ?? 5),
      paused: Boolean(settingsMap.crawl?.paused),
    }),
    [settingsMap.crawl]
  )
  const normalizationSettings = useMemo(
    () => ({
      enabled: Boolean(settingsMap.normalization?.enabled ?? true),
      model: String(settingsMap.normalization?.model ?? DEFAULT_HAIKU_MODEL),
    }),
    [settingsMap.normalization]
  )
  const emailSettings = useMemo(
    () => ({
      fromName: String(settingsMap.email?.fromName ?? meta?.resendFromName ?? "Hireoven"),
      fromEmail: String(settingsMap.email?.fromEmail ?? meta?.resendFromEmail ?? ""),
    }),
    [settingsMap.email, meta?.resendFromEmail, meta?.resendFromName]
  )

  async function upsertSetting(key: string, value: Record<string, unknown>, successTitle: string) {
    setBusyAction(key)
    const res = await fetch("/api/admin/system-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    })
    setBusyAction(null)

    if (!res.ok) {
      pushToast({ tone: "error", title: "Unable to save settings" })
      return false
    }

    await loadSettings()
    pushToast({ tone: "success", title: successTitle })
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
    const res = await fetch(`/api/admin/crawl-logs?before=${encodeURIComponent(cutoff)}`, { method: "DELETE" })
    setBusyAction(null)

    if (!res.ok) {
      pushToast({ tone: "error", title: "Unable to clear crawl logs" })
      return
    }

    pushToast({ tone: "success", title: "Old crawl logs removed" })
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
    const [companies, jobs, notifications, crawlLogs, settings] = await Promise.all([
      fetch("/api/admin/companies").then((r) => r.json()),
      fetch("/api/jobs?limit=5000").then((r) => r.json()),
      fetch("/api/admin/alert-notifications").then((r) => r.json()),
      fetch("/api/admin/crawl-logs").then((r) => r.json()),
      fetch("/api/admin/system-settings").then((r) => r.json()),
    ])
    setBusyAction(null)

    const exportData = { companies, jobs, notifications, crawlLogs, settings }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `hireoven-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)

    pushToast({
      tone: "success",
      title: "Data export ready",
    })
  }

  if (loading && !rows.length && !meta) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5">
        <div className="relative flex h-20 w-20 items-center justify-center">
          <div
            className="absolute inset-0 rounded-[24px] bg-gradient-to-br from-orange-400 via-fuchsia-500 to-cyan-400 opacity-60 blur-xl"
            aria-hidden
          />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-white to-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.15)] ring-2 ring-white">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" aria-hidden />
          </div>
        </div>
        <div className="text-center">
          <p className="bg-gradient-to-r from-orange-600 via-fuchsia-600 to-cyan-600 bg-clip-text text-base font-bold text-transparent">
            Loading configuration
          </p>
          <p className="mt-1 text-xs font-medium text-slate-500">Pulling keys, mail, and push settings…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative mx-auto max-w-[1020px] space-y-8 pb-28">
      <div
        className="pointer-events-none absolute -left-32 -top-24 h-72 w-72 rounded-full bg-gradient-to-br from-orange-400/50 to-fuchsia-500/30 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-24 top-40 h-64 w-64 rounded-full bg-gradient-to-br from-cyan-400/40 to-blue-600/25 blur-3xl"
        aria-hidden
      />

      <div className="relative overflow-hidden rounded-3xl border border-white/80 bg-white/90 p-8 shadow-[0_24px_80px_-20px_rgba(234,88,12,0.25)] ring-1 ring-orange-200/60 backdrop-blur-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-[320px] w-[320px] rounded-full bg-gradient-to-br from-fuchsia-500/25 via-orange-400/20 to-transparent blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-16 left-1/4 h-40 w-52 rounded-full bg-gradient-to-br from-sky-400/30 to-transparent blur-2xl"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500/15 via-fuchsia-500/15 to-cyan-500/15 px-3 py-1 ring-1 ring-orange-400/40">
              <Zap className="h-3.5 w-3.5 text-orange-600" aria-hidden strokeWidth={2.5} />
              <span className="bg-gradient-to-r from-orange-700 via-fuchsia-700 to-blue-700 bg-clip-text text-[10px] font-extrabold uppercase tracking-[0.34em] text-transparent">
                Control center · Settings
              </span>
            </div>
            <h1 className="bg-gradient-to-r from-orange-600 via-[#db2777] to-indigo-700 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-[2.65rem] sm:leading-[1.1]">
              System configuration
            </h1>
            <p className="max-w-2xl text-[15px] leading-relaxed text-slate-600">
              Tune crawlers, AI normalization, transactional email, and web push — each zone has its own color so you{" "}
              <span className="font-semibold text-slate-800">know where you are</span> at a glance.
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadSettings()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 via-orange-600 to-rose-600 px-6 py-3 text-sm font-bold text-white shadow-[0_16px_40px_-10px_rgba(234,88,12,0.55)] transition hover:brightness-110 hover:shadow-[0_20px_48px_-8px_rgba(234,88,12,0.6)] active:brightness-95 disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-4 w-4", loading && rows.length ? "animate-spin" : "")}
              aria-hidden
            />
            Reload settings
          </button>
        </div>
      </div>

      <nav
        aria-label="Section navigation"
        className="scrollbar-none sticky top-[4.5rem] z-10 -mx-2 flex gap-2.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/95 px-3 py-3 shadow-[0_14px_40px_-18px_rgba(15,23,42,0.15)] backdrop-blur-md sm:flex-wrap sm:justify-center lg:justify-start"
      >
        {SETTINGS_NAV.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[10px] font-extrabold uppercase tracking-[0.18em] transition",
              item.chip
            )}
          >
            {item.label}
            <ArrowRight className="h-3 w-3 opacity-70" aria-hidden />
          </a>
        ))}
      </nav>

      <SettingsSection
        id="crawler"
        accent="ocean"
        icon={Radar}
        eyebrow="Throughput"
        title="Job crawler"
        description="Cadence for scheduled crawls across active companies."
        actions={
          <AdminButton
            tone="secondary"
            className="border-cyan-200/90 bg-white font-bold shadow-[0_8px_24px_-6px_rgba(14,165,233,0.35)] hover:bg-cyan-50"
            disabled={busyAction === "crawl"}
            onClick={() => void upsertSetting("crawl", { ...crawlSettings }, "Crawler settings saved")}
          >
            {busyAction === "crawl" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Save crawler
          </AdminButton>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <SettingField
            htmlFor="crawl-interval"
            label="Schedule interval"
            hint="Minutes between crawl scheduling cycles across the fleet."
          >
            <AdminInput
              id="crawl-interval"
              type="number"
              inputMode="numeric"
              min={1}
              value={String(crawlSettings.intervalMinutes)}
              onChange={(event) =>
                setSettingValue("crawl", {
                  ...crawlSettings,
                  intervalMinutes: Number(event.target.value),
                })
              }
              className="border-cyan-200/70 focus:border-cyan-400 focus:ring-cyan-500/25"
            />
          </SettingField>
          <SettingField
            htmlFor="crawl-max"
            label="Max concurrent crawls"
            hint="Cap parallel workers to bound database and queue load."
          >
            <AdminInput
              id="crawl-max"
              type="number"
              inputMode="numeric"
              min={1}
              value={String(crawlSettings.maxConcurrentCrawls)}
              onChange={(event) =>
                setSettingValue("crawl", {
                  ...crawlSettings,
                  maxConcurrentCrawls: Number(event.target.value),
                })
              }
              className="border-cyan-200/70 focus:border-cyan-400 focus:ring-cyan-500/25"
            />
          </SettingField>
        </div>

        <label
          htmlFor="crawl-paused"
          className="group mt-6 flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-cyan-200/70 bg-gradient-to-r from-cyan-100/50 via-white to-sky-50/60 p-4 shadow-inner transition hover:from-cyan-100 hover:to-sky-100/70"
        >
          <div className="min-w-0">
            <span className="text-[13px] font-bold text-slate-900">Pause all crawls</span>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-700">
              Stops issuing new crawl work until you unpause — useful during incidents or deployments.
            </p>
          </div>
          <span className="flex h-11 shrink-0 items-center">
            <input
              id="crawl-paused"
              type="checkbox"
              className="h-5 w-5 rounded border-cyan-400 text-cyan-600 focus:ring-cyan-500"
              checked={crawlSettings.paused}
              onChange={(event) =>
                setSettingValue("crawl", {
                  ...crawlSettings,
                  paused: event.target.checked,
                })
              }
            />
          </span>
        </label>
      </SettingsSection>

      <SettingsSection
        id="ai"
        accent="aurora"
        icon={Sparkles}
        eyebrow="Intelligence"
        title="Normalization & extraction"
        description="Controls LLM-assisted job normalization and structuring."
        actions={
          <AdminButton
            tone="secondary"
            disabled={busyAction === "normalization"}
            className="border-fuchsia-200/90 bg-white font-bold shadow-[0_8px_24px_-6px_rgba(192,38,211,0.35)] hover:bg-fuchsia-50"
            onClick={() =>
              void upsertSetting("normalization", normalizationSettings, "Normalization settings saved")
            }
          >
            {busyAction === "normalization" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Save AI settings
          </AdminButton>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[1fr,minmax(0,2fr)] lg:items-end">
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-fuchsia-200/70 bg-gradient-to-br from-violet-100/60 via-white to-fuchsia-50 p-4 shadow-[0_8px_30px_-12px_rgba(147,51,234,0.35)] ring-1 ring-fuchsia-400/50">
            <span className="min-w-0">
              <span className="text-[13px] font-bold text-slate-900">Enable normalization</span>
              <span className="mt-1 block text-[12px] leading-relaxed text-slate-700">
                When off, ingestion keeps raw payloads without enrichment.
              </span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 rounded border-fuchsia-400 text-fuchsia-600 focus:ring-fuchsia-500"
              checked={normalizationSettings.enabled}
              onChange={(event) =>
                setSettingValue("normalization", {
                  ...normalizationSettings,
                  enabled: event.target.checked,
                })
              }
            />
          </label>

          <SettingField
            htmlFor="norm-model"
            label="Anthropic model"
            hint="Applies to the normalization pipeline tied to Claude."
          >
            <AdminSelect
              id="norm-model"
              value={normalizationSettings.model}
              onChange={(event) =>
                setSettingValue("normalization", {
                  ...normalizationSettings,
                  model: event.target.value,
                })
              }
              className="border-fuchsia-200/70 focus:border-fuchsia-400 focus:ring-fuchsia-500/25"
            >
              {!ANTHROPIC_MODEL_OPTIONS.includes(normalizationSettings.model as (typeof ANTHROPIC_MODEL_OPTIONS)[number]) ? (
                <option value={normalizationSettings.model}>{normalizationSettings.model}</option>
              ) : null}
              {ANTHROPIC_MODEL_OPTIONS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </AdminSelect>
          </SettingField>
        </div>
      </SettingsSection>

      <SettingsSection
        id="email"
        accent="royal"
        icon={Mail}
        eyebrow="Delivery"
        title="Outbound email"
        description="Envelope identity presented to transactional mail (Resend). Always send a dry run before rollout."
        actions={
          <div className="flex flex-wrap gap-2">
            <AdminButton
              tone="secondary"
              className="border-indigo-200/90 bg-white font-bold shadow-[0_8px_24px_-6px_rgba(79,70,229,0.3)] hover:bg-indigo-50"
              disabled={busyAction === "email"}
              onClick={() => void upsertSetting("email", emailSettings, "Email settings saved")}
            >
              {busyAction === "email" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Save email
            </AdminButton>
            <AdminButton
              className="bg-gradient-to-r from-indigo-600 to-violet-700 font-bold text-white shadow-[0_14px_32px_-8px_rgba(79,70,229,0.55)] hover:brightness-110"
              disabled={busyAction === "email"}
              onClick={() => void runTest("email")}
            >
              {busyAction === "email" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="mr-2 h-4 w-4" aria-hidden />
              )}
              Test email
            </AdminButton>
          </div>
        }
      >
        <div className="grid gap-6 md:grid-cols-2">
          <SettingField label="From name" hint="Shown as the sender display name.">
            <AdminInput
              value={emailSettings.fromName}
              onChange={(event) =>
                setSettingValue("email", {
                  ...emailSettings,
                  fromName: event.target.value,
                })
              }
              placeholder="Hireoven"
              className="border-indigo-200/70 focus:border-indigo-400 focus:ring-indigo-500/25"
            />
          </SettingField>
          <SettingField label="From address" hint="Must be a verified domain in Resend.">
            <AdminInput
              type="email"
              value={emailSettings.fromEmail}
              onChange={(event) =>
                setSettingValue("email", {
                  ...emailSettings,
                  fromEmail: event.target.value,
                })
              }
              placeholder="hello@yourdomain.com"
              className="border-indigo-200/70 focus:border-indigo-400 focus:ring-indigo-500/25"
            />
          </SettingField>
        </div>
        {meta?.adminEmail ? (
          <div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-100/90 to-blue-50 px-4 py-2 ring-1 ring-indigo-200/80">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-800">Routing</span>
            <span className="text-[12px] text-slate-800">
              Admin contact:{" "}
              <span className="font-semibold text-indigo-950">{meta.adminEmail}</span>
            </span>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        id="push"
        accent="blaze"
        icon={Radio}
        eyebrow="Web push"
        title="Browser notifications"
        description="VAPID keys pair your server with clients. Copy generated keys into environment — they are not written automatically."
        actions={
          <div className="flex flex-wrap gap-2">
            <AdminButton
              tone="secondary"
              disabled={busyAction === "vapid"}
              className="border-orange-300/90 bg-white font-bold shadow-[0_8px_24px_-6px_rgba(234,88,12,0.35)] hover:bg-orange-50"
              onClick={() => void regenerateVapid()}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              Regenerate keys
            </AdminButton>
            <AdminButton
              className="bg-gradient-to-r from-orange-500 to-red-600 font-bold text-white shadow-[0_14px_36px_-8px_rgba(234,88,12,0.55)] hover:brightness-110"
              disabled={busyAction === "push"}
              onClick={() => void runTest("push")}
            >
              {busyAction === "push" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="mr-2 h-4 w-4" aria-hidden />
              )}
              Test push
            </AdminButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="bg-gradient-to-r from-orange-800 to-red-700 bg-clip-text text-[10px] font-extrabold uppercase tracking-[0.26em] text-transparent">
                Active public key
              </p>
              <AdminBadge tone="warning">Live</AdminBadge>
            </div>
            <div className="mt-3 overflow-hidden rounded-xl border border-orange-900/70 bg-[#0f172a] p-[3px] shadow-[0_20px_50px_-12px_rgba(234,88,12,0.45)] ring-2 ring-orange-400/35">
              <pre className="max-h-[200px] overflow-auto rounded-[10px] bg-gradient-to-br from-[#020617] to-[#172554] px-4 py-3 font-mono text-[11px] leading-relaxed text-sky-100">
                {meta?.vapidPublicKey?.trim()
                  ? meta.vapidPublicKey.trim()
                  : "No VAPID public key configured — generate a pair below."}
              </pre>
            </div>
          </div>

          {generatedVapid ? (
            <div className="rounded-2xl border border-amber-300/90 bg-gradient-to-br from-yellow-300/25 via-orange-50 to-red-50 p-5 shadow-inner ring-1 ring-orange-300/70">
              <p className="text-[13px] font-bold text-orange-950">New keys · paste into `.env.local`</p>
              <p className="mt-2 text-[12px] leading-relaxed text-orange-900/95">
                These are ephemeral until you persist them server-side.
              </p>
              <pre className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-orange-200/90 bg-white/95 p-3 font-mono text-[11px] text-orange-950 shadow-inner">
                {JSON.stringify(generatedVapid, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        id="danger"
        accent="danger"
        icon={ShieldAlert}
        eyebrow="Irreversible"
        title="Danger zone"
        description="Operational controls with global blast radius — confirm each action carefully."
      >
        <div className="grid gap-5 md:grid-cols-3">
          <DangerCard
            title="Clear crawl logs"
            description="Deletes rows older than 30 days."
            accent="destructive"
            icon={ScrollText}
            busy={busyAction === "clear-logs"}
            onClick={() => void clearOldLogs()}
          />
          <DangerCard
            title="Full re-crawl"
            description="Queues every active company immediately."
            accent="severe"
            icon={ShieldAlert}
            busy={busyAction === "recrawl"}
            onClick={() => void recrawlAll()}
          />
          <DangerCard
            title="Export snapshot"
            description="Download JSON for audits and drills."
            accent="neutral"
            icon={Download}
            busy={busyAction === "export"}
            onClick={() => void exportAllData()}
          />
        </div>
      </SettingsSection>

      <p className="text-center">
        <span className="bg-gradient-to-r from-slate-400 via-orange-600 to-fuchsia-600 bg-clip-text text-[11px] font-semibold uppercase tracking-[0.24em] text-transparent">
          Save per section · server audited · admins only
        </span>
      </p>
    </div>
  )
}

function DangerCard({
  title,
  description,
  accent,
  icon: Icon,
  busy,
  onClick,
}: {
  title: string
  description: string
  accent: "destructive" | "severe" | "neutral"
  icon: React.ComponentType<{ className?: string }>
  busy?: boolean
  onClick: () => void
}) {
  const skins = {
    destructive: {
      wrap: "border-red-400/40 bg-gradient-to-br from-red-600 via-rose-700 to-red-950 p-[2px] shadow-[0_22px_50px_-14px_rgba(220,38,38,0.55)]",
      inner: "bg-gradient-to-br from-red-950/95 via-red-950/90 to-neutral-950 text-white",
      iconBg: "bg-white/15 text-white ring-white/35",
      cta: "text-red-100 group-hover:text-white",
    },
    severe: {
      wrap: "border-amber-400/45 bg-gradient-to-br from-yellow-400 via-orange-500 to-red-700 p-[2px] shadow-[0_22px_50px_-14px_rgba(234,88,12,0.5)]",
      inner: "bg-gradient-to-br from-orange-950/95 via-amber-900/92 to-orange-950/98 text-orange-50",
      iconBg: "bg-orange-400/35 text-orange-50 ring-orange-400/55",
      cta: "text-amber-100 group-hover:text-white",
    },
    neutral: {
      wrap: "border-emerald-400/40 bg-gradient-to-br from-emerald-400 via-teal-500 to-emerald-900 p-[2px] shadow-[0_22px_50px_-14px_rgba(16,185,129,0.45)]",
      inner: "bg-gradient-to-br from-emerald-950/93 via-teal-950/88 to-neutral-950 text-emerald-50",
      iconBg: "bg-emerald-400/35 text-emerald-50 ring-emerald-400/60",
      cta: "text-emerald-100 group-hover:text-white",
    },
  } as const
  const s = skins[accent]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "group relative rounded-2xl text-left transition hover:-translate-y-1 hover:shadow-2xl disabled:opacity-60",
        s.wrap
      )}
    >
      <div className={cn("relative rounded-[14px] p-[1px]", s.inner)}>
        <div className="relative rounded-[13px] p-5 pt-10">
          {busy ? (
            <Loader2 className="mx-auto mb-6 h-9 w-9 animate-spin text-white/90" aria-hidden />
          ) : (
            <>
              <span className={cn("inline-flex h-12 w-12 items-center justify-center rounded-xl ring-2", s.iconBg)}>
                <Icon className="h-6 w-6" aria-hidden strokeWidth={2.25} />
              </span>
              {accent !== "neutral" ? (
                <AlertTriangle
                  className="absolute right-4 top-4 h-4 w-4 text-white/30 transition group-hover:text-white/55"
                  aria-hidden
                />
              ) : null}
            </>
          )}
          {!busy ? (
            <>
              <p className="mt-5 text-[13px] font-bold leading-snug">{title}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-white/80">{description}</p>
              <span
                className={cn(
                  "mt-6 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.18em]",
                  s.cta
                )}
              >
                Run action
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </span>
            </>
          ) : (
            <>
              <p className="mt-5 text-[13px] font-bold">{title}</p>
              <p className="sr-only">{description}</p>
            </>
          )}
        </div>
      </div>
    </button>
  )
}
