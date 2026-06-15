"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  FileEdit,
  Info,
  Lightbulb,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { VisibilityScore } from "@/lib/brand/visibility-scorer"
import type { BrandAuditItem } from "@/lib/brand/audit-engine"
import type { ContentDraft } from "@/lib/brand/draft-writer"

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "overview" | "ideas" | "drafts"

type ContentIdea = {
  id: string
  title: string
  hook: string
  content_type: string
  topic_tags: string[]
  status: string
  best_day_to_post: string | null
  estimated_reach_min: number | null
  estimated_reach_max: number | null
  generated_from: string
}

type WeeklyAction = {
  action: string
  type: string
  estimatedMinutes: number
}

type BrandProfile = {
  linkedin_url: string | null
  linkedin_connected: boolean
  linkedin_last_synced_at: string | null
  visibility_score: number
  posting_frequency_target: number
  communities_active: number
  recommendations_count: number | null
  estimated_connections: number | null
  has_about_section: boolean | null
  headline: string | null
  last_post_detected_at: string | null
  days_since_last_activity: number | null
}

type BrandRescanResponse = {
  profile: BrandProfile
  score: VisibilityScore
  auditItems: BrandAuditItem[]
  weeklyActions: WeeklyAction[]
  scan?: { source: string; message: string }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtReach(min: number | null, max: number | null): string {
  if (!min || !max) return ""
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n)
  return `${fmt(min)}–${fmt(max)} reach`
}

const VERDICT_CONFIG = {
  strong:    { label: "Strong",    color: "#16a34a", bg: "#f0fdf4", ring: "ring-emerald-200" },
  building:  { label: "Building",  color: "#d97706", bg: "#fffbeb", ring: "ring-amber-200" },
  low:       { label: "Low",       color: "#ea580c", bg: "#fff7ed", ring: "ring-orange-200" },
  invisible: { label: "Invisible", color: "#dc2626", bg: "#fef2f2", ring: "ring-red-200" },
} as const

const AUDIT_SEVERITY_CONFIG = {
  high: {
    label: "High priority",
    Icon: AlertCircle,
    iconClass: "bg-red-50 text-red-600 ring-red-100",
    badgeClass: "bg-red-50 text-red-700 ring-red-100",
  },
  medium: {
    label: "Medium priority",
    Icon: AlertTriangle,
    iconClass: "bg-amber-50 text-amber-600 ring-amber-100",
    badgeClass: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  low: {
    label: "Low priority",
    Icon: Info,
    iconClass: "bg-slate-50 text-slate-500 ring-slate-100",
    badgeClass: "bg-slate-50 text-slate-600 ring-slate-100",
  },
} as const

const CONTENT_TYPE_LABELS: Record<string, string> = {
  linkedin_post: "LinkedIn Post",
  linkedin_article: "Article",
  community_post: "Community Post",
  recommendation_request: "Recommendation Request",
  profile_update: "Profile Update",
  about_section: "About Section",
  headline: "Headline",
}

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "personal", label: "Personal" },
  { value: "technical", label: "Technical" },
  { value: "warm", label: "Warm" },
] as const

const MANUAL_PROFILE_FIELDS = [
  {
    label: "Recommendations",
    key: "recommendations_count",
    helper: "Received on LinkedIn",
    suffix: "received",
    Icon: Award,
  },
  {
    label: "Connections",
    key: "estimated_connections",
    helper: "Network size",
    suffix: "people",
    Icon: Users,
  },
  {
    label: "Communities",
    key: "communities_active",
    helper: "Groups or newsletters",
    suffix: "active",
    Icon: MessageSquare,
  },
  {
    label: "Activity age",
    key: "days_since_last_activity",
    helper: "Lower is better",
    suffix: "days",
    Icon: Activity,
  },
] as const

// ── Score ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, verdict }: { score: number; verdict: string }) {
  const cfg = VERDICT_CONFIG[verdict as keyof typeof VERDICT_CONFIG] ?? VERDICT_CONFIG.low
  const r = 38, c = Math.PI * r * 2
  const pct = score / 100

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="96" height="96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#f1f5f9" strokeWidth="7" />
        <circle
          cx="48" cy="48" r={r} fill="none"
          stroke={cfg.color} strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${pct * c} ${c}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[24px] font-black tabular-nums" style={{ color: cfg.color }}>{score}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: cfg.color }}>{cfg.label}</span>
      </div>
    </div>
  )
}

// ── Breakdown bar ─────────────────────────────────────────────────────────────

function BreakdownBar({ label, score, max, note }: { label: string; score: number; max: number; note: string }) {
  const pct = Math.round((score / max) * 100)
  const color = pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#94a3b8"

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-slate-700">{label}</span>
        <span className="text-[12px] font-bold tabular-nums" style={{ color }}>{score}/{max}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="text-[11px] text-slate-400">{note}</p>
    </div>
  )
}

// ── Audit item ────────────────────────────────────────────────────────────────

function AuditItem({ item, onAction }: { item: BrandAuditItem; onAction: () => void }) {
  const cfg = AUDIT_SEVERITY_CONFIG[item.severity] ?? AUDIT_SEVERITY_CONFIG.low
  const Icon = cfg.Icon

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300">
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1", cfg.iconClass)}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ring-1", cfg.badgeClass)}>
              {cfg.label}
            </span>
            <span className="text-[11px] font-medium text-slate-400">{CONTENT_TYPE_LABELS[item.item_type] ?? item.item_type.replace(/_/g, " ")}</span>
          </div>
          <p className="text-[14.5px] font-bold text-slate-950">{item.title}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{item.detail}</p>
          <button
            type="button"
            onClick={onAction}
            className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-left text-[12.5px] font-semibold leading-snug text-[var(--color-primary,#2563eb)] ring-1 ring-slate-200 transition hover:bg-blue-50 hover:ring-blue-100"
          >
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            <span>{item.fix_action}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Idea card ─────────────────────────────────────────────────────────────────

function IdeaCard({
  idea,
  onWrite,
  onSkip,
  writing,
}: {
  idea: ContentIdea
  onWrite: (idea: ContentIdea) => void
  onSkip: (id: string) => void
  writing: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <span className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
          {CONTENT_TYPE_LABELS[idea.content_type] ?? idea.content_type}
          {idea.best_day_to_post ? ` · Post ${idea.best_day_to_post}` : ""}
        </span>
        {(idea.estimated_reach_min || idea.estimated_reach_max) && (
          <span className="shrink-0 text-[11px] text-slate-400">{fmtReach(idea.estimated_reach_min, idea.estimated_reach_max)}</span>
        )}
      </div>
      <p className="text-[15px] font-semibold text-slate-900 mb-1">{idea.title}</p>
      <p className="text-[13px] text-slate-500 italic mb-3">"{idea.hook}"</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {idea.topic_tags.map((t) => (
          <span key={t} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">{t}</span>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
        <button
          type="button"
          disabled={writing}
          onClick={() => onWrite(idea)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
            writing ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800"
          )}
        >
          {writing
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Writing…</>
            : <><Pencil className="h-3.5 w-3.5" />Write this</>
          }
        </button>
        <button
          type="button"
          onClick={() => onSkip(idea.id)}
          className="text-[12px] text-slate-400 hover:text-slate-600"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

// ── Draft card ────────────────────────────────────────────────────────────────

function DraftCard({ draft }: { draft: ContentDraft }) {
  const [copied, setCopied] = useState(false)
  const overLimit = draft.charCount > draft.charLimit

  async function copy() {
    await navigator.clipboard.writeText(draft.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
          {CONTENT_TYPE_LABELS[draft.contentType] ?? draft.contentType} · {draft.tone}
        </span>
        <span className={cn("text-[11px] font-semibold tabular-nums", overLimit ? "text-red-500" : "text-slate-400")}>
          {draft.charCount}/{draft.charLimit}
        </span>
      </div>
      <p className="text-[14px] font-semibold text-slate-900 mb-3">{draft.title}</p>
      <pre className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap font-sans mb-3 max-h-48 overflow-y-auto rounded-lg bg-slate-50 p-3 border border-slate-100">
        {draft.content}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
      >
        {copied
          ? <><Check className="h-3.5 w-3.5 text-emerald-500" />Copied!</>
          : <><Copy className="h-3.5 w-3.5" />Copy to clipboard</>
        }
      </button>
    </div>
  )
}

// ── LinkedIn URL prompt ───────────────────────────────────────────────────────

function LinkedInPrompt({ onSave }: { onSave: (url: string) => void }) {
  const [url, setUrl] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!url.trim()) return
    setSaving(true)
    try {
      await fetch("/api/brand/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: url.trim() }),
      })
      onSave(url.trim())
    } finally { setSaving(false) }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 mb-5">
      <p className="text-[13.5px] font-semibold text-slate-800 mb-0.5">Add your LinkedIn URL to improve your score</p>
      <p className="text-[12px] text-slate-400 mb-3">We use it to estimate your profile completeness. No API connection required.</p>
      <div className="flex gap-2">
        <input
          type="url"
          placeholder="https://linkedin.com/in/yourname"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#2563eb)] focus:ring-2 focus:ring-blue-100"
        />
        <button
          type="button"
          disabled={saving || !url.trim()}
          onClick={save}
          className={cn("rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-colors",
            saving || !url.trim() ? "bg-slate-200 cursor-not-allowed text-slate-400" : "bg-[var(--color-primary,#2563eb)] hover:bg-blue-700"
          )}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}

function profileHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

function formatScanTime(value: string | null | undefined): string {
  if (!value) return "Not scanned yet"
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatActivityAge(days: number | null | undefined): string {
  if (days === null || days === undefined) return "activity unknown"
  if (days <= 0) return "activity today"
  if (days === 1) return "activity 1 day ago"
  if (days < 30) return `activity ${days} days ago`
  if (days < 365) return `activity ${Math.round(days / 30)} months ago`
  return `activity ${Math.round(days / 365)} years ago`
}

function LinkedInRescanPanel({
  profile,
  rescanning,
  message,
  onRescan,
}: {
  profile: BrandProfile
  rescanning: boolean
  message: string | null
  onRescan: () => void
}) {
  if (!profile.linkedin_url) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">LinkedIn profile</p>
          <a
            href={profileHref(profile.linkedin_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate text-[13px] font-semibold text-slate-900 hover:text-orange-700"
          >
            {profile.linkedin_url}
          </a>
          <p className="mt-1 text-[12px] text-slate-500">
            Last scanned: {formatScanTime(profile.linkedin_last_synced_at)}
            {profile.linkedin_connected ? " · public metadata found" : " · using saved profile data"}
            {" · "}
            {formatActivityAge(profile.days_since_last_activity)}
          </p>
        </div>

        <button
          type="button"
          onClick={onRescan}
          disabled={rescanning}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors",
            rescanning
              ? "cursor-not-allowed bg-slate-100 text-slate-400"
              : "bg-slate-950 text-white hover:bg-slate-800"
          )}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", rescanning && "animate-spin")} />
          {rescanning ? "Scanning..." : "Rescan LinkedIn"}
        </button>
      </div>

      {message ? (
        <p className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] leading-relaxed text-orange-800">
          {message}
        </p>
      ) : null}
    </div>
  )
}

// ── Weekly actions strip ──────────────────────────────────────────────────────

function WeeklyActions({ actions }: { actions: WeeklyAction[] }) {
  if (actions.length === 0) return null
  const actionIcon = (type: string) => {
    if (type === "fix") return <Wrench className="h-4 w-4 shrink-0 text-slate-500" />
    if (type === "post") return <FileEdit className="h-4 w-4 shrink-0 text-slate-500" />
    return <Lightbulb className="h-4 w-4 shrink-0 text-slate-500" />
  }

  return (
    <div className="mb-6">
      <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400 mb-3">This week&apos;s focus</p>
      <div className="space-y-2">
        {actions.map((a, i) => (
          <div key={i} className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 border border-slate-100">
            {actionIcon(a.type)}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-slate-700 font-medium">{a.action}</p>
              <p className="text-[11px] text-slate-400">~{a.estimatedMinutes} min</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

export default function PersonalBrandHub() {
  const [tab, setTab] = useState<Tab>("overview")
  const [profile, setProfile] = useState<BrandProfile | null>(null)
  const [score, setScore] = useState<VisibilityScore | null>(null)
  const [auditItems, setAuditItems] = useState<BrandAuditItem[]>([])
  const [weeklyActions, setWeeklyActions] = useState<WeeklyAction[]>([])
  const [ideas, setIdeas] = useState<ContentIdea[]>([])
  const [drafts, setDrafts] = useState<ContentDraft[]>([])
  const [scoreLoading, setScoreLoading] = useState(true)
  const [ideasLoading, setIdeasLoading] = useState(false)
  const [generatingIdeas, setGeneratingIdeas] = useState(false)
  const [writingIdeaId, setWritingIdeaId] = useState<string | null>(null)
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [toneForIdea, setToneForIdea] = useState<"professional" | "personal" | "technical" | "warm">("professional")
  const [ideaSource, setIdeaSource] = useState<"cv" | "trending">("cv")
  const [error, setError] = useState<string | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const [rescanMessage, setRescanMessage] = useState<string | null>(null)

  const loadProfile = useCallback(async () => {
    try {
      const r = await fetch("/api/brand/profile")
      if (r.ok) {
        const d = await r.json() as { profile: BrandProfile | null }
        setProfile(d.profile)
      }
    } catch { /* silent */ }
  }, [])

  const loadScore = useCallback(async () => {
    setScoreLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/brand/score")
      if (!r.ok) throw new Error("Failed")
      const d = await r.json() as { score: VisibilityScore; auditItems: BrandAuditItem[]; weeklyActions: WeeklyAction[] }
      setScore(d.score)
      setAuditItems(d.auditItems)
      setWeeklyActions(d.weeklyActions)
    } catch { setError("Could not load your brand score.") }
    finally { setScoreLoading(false) }
  }, [])

  const loadIdeas = useCallback(async () => {
    setIdeasLoading(true)
    try {
      const r = await fetch("/api/brand/ideas")
      if (r.ok) {
        const d = await r.json() as { ideas: ContentIdea[] }
        setIdeas(d.ideas)
      }
    } finally { setIdeasLoading(false) }
  }, [])

  const loadDrafts = useCallback(async () => {
    setDraftsLoading(true)
    try {
      const r = await fetch("/api/brand/draft")
      if (r.ok) {
        const d = await r.json() as { drafts: ContentDraft[] }
        setDrafts(d.drafts)
      }
    } finally { setDraftsLoading(false) }
  }, [])

  useEffect(() => { loadProfile(); loadScore() }, [loadProfile, loadScore])
  useEffect(() => { if (tab === "ideas") loadIdeas() }, [tab, loadIdeas])
  useEffect(() => { if (tab === "drafts") loadDrafts() }, [tab, loadDrafts])

  async function handleGenerateIdeas() {
    setGeneratingIdeas(true)
    try {
      const r = await fetch("/api/brand/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: ideaSource }),
      })
      if (r.ok) {
        const d = await r.json() as { ideas: ContentIdea[] }
        setIdeas((prev) => [...d.ideas, ...prev].slice(0, 20))
      }
    } finally { setGeneratingIdeas(false) }
  }

  async function handleWriteIdea(idea: ContentIdea) {
    setWritingIdeaId(idea.id)
    try {
      const r = await fetch("/api/brand/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: idea.content_type,
          title: idea.title,
          hook: idea.hook,
          generatedFrom: idea.generated_from,
          tone: toneForIdea,
          topicTags: idea.topic_tags,
          ideaId: idea.id,
        }),
      })
      if (r.ok) {
        const d = await r.json() as { draft: ContentDraft }
        setDrafts((prev) => [d.draft, ...prev])
        await fetch("/api/brand/ideas", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: idea.id, status: "written" }),
        })
        setIdeas((prev) => prev.map((i) => i.id === idea.id ? { ...i, status: "written" } : i))
        setTab("drafts")
      }
    } finally { setWritingIdeaId(null) }
  }

  async function handleSkipIdea(id: string) {
    await fetch("/api/brand/ideas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "skipped" }),
    })
    setIdeas((prev) => prev.filter((i) => i.id !== id))
  }

  function scanLinkedInWithExtension(url: string | null | undefined): Promise<
    { status: "synced" } | { status: "unavailable" } | { status: "failed"; error: string }
  > {
    if (typeof window === "undefined") return Promise.resolve({ status: "unavailable" })

    return new Promise((resolve) => {
      let started = false
      let settled = false
      let ackTimer: ReturnType<typeof setTimeout> | null = null
      let resultTimer: ReturnType<typeof setTimeout> | null = null

      const cleanup = () => {
        window.removeEventListener("message", handler)
        if (ackTimer) clearTimeout(ackTimer)
        if (resultTimer) clearTimeout(resultTimer)
      }

      const settle = (result: { status: "synced" } | { status: "unavailable" } | { status: "failed"; error: string }) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const handler = (event: MessageEvent) => {
        if (event.source !== window) return
        if (typeof event.data !== "object" || event.data === null) return
        const msg = event.data as Record<string, unknown>
        if (msg.source !== "hireoven-ext") return

        if (msg.type === "LINKEDIN_BRAND_PROFILE_SCAN_STARTED") {
          started = true
          if (ackTimer) clearTimeout(ackTimer)
          return
        }

        if (msg.type === "LINKEDIN_BRAND_PROFILE_RESULT") {
          if (msg.ok === true) {
            settle({ status: "synced" })
          } else {
            settle({
              status: "failed",
              error: typeof msg.error === "string" && msg.error
                ? msg.error
                : "Extension could not read LinkedIn.",
            })
          }
        }
      }

      window.addEventListener("message", handler)
      window.postMessage(
        {
          source: "hireoven-apex",
          type: "BRAND_RESCAN_LINKEDIN",
          ...(url ? { url } : {}),
        },
        window.location.origin
      )

      ackTimer = setTimeout(() => {
        if (!started) settle({ status: "unavailable" })
      }, 1200)

      resultTimer = setTimeout(() => {
        settle({ status: "failed", error: "Extension scan timed out." })
      }, 45_000)
    })
  }

  async function handleRescanLinkedIn() {
    setRescanning(true)
    setError(null)
    setRescanMessage(null)
    try {
      const extensionScan = await scanLinkedInWithExtension(profile?.linkedin_url)
      if (extensionScan.status === "synced") {
        await Promise.all([loadProfile(), loadScore()])
        setRescanMessage("LinkedIn refreshed through the Chrome extension.")
        return
      }
      if (extensionScan.status === "failed") {
        setRescanMessage(`${extensionScan.error} Falling back to public LinkedIn scan.`)
      }

      const r = await fetch("/api/brand/rescan", { method: "POST" })
      const d = await r.json().catch(() => ({})) as Partial<BrandRescanResponse> & { error?: string }
      if (!r.ok || !d.profile || !d.score) {
        throw new Error(d.error ?? "Could not rescan LinkedIn.")
      }

      setProfile(d.profile)
      setScore(d.score)
      setAuditItems(d.auditItems ?? [])
      setWeeklyActions(d.weeklyActions ?? [])
      setRescanMessage((prev) => {
        const publicMessage = d.scan?.message ?? "LinkedIn profile refreshed."
        return prev ? `${prev} ${publicMessage}` : publicMessage
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rescan LinkedIn.")
    } finally {
      setRescanning(false)
    }
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
    { id: "ideas", label: "Content ideas", icon: <Lightbulb className="h-4 w-4" /> },
    { id: "drafts", label: "Drafts", icon: <FileEdit className="h-4 w-4" /> },
  ]

  return (
    <div className="w-full pb-12">
      {/* Tab bar */}
      <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors",
              tab === t.id
                ? "bg-orange-50 text-orange-700"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {!profile?.linkedin_url && (
            <LinkedInPrompt
              onSave={(url) => {
                setProfile((p) => p ? { ...p, linkedin_url: url } : null)
                setRescanMessage("LinkedIn URL saved. Run a rescan to refresh your score.")
              }}
            />
          )}

          {profile?.linkedin_url && (
            <LinkedInRescanPanel
              profile={profile}
              rescanning={rescanning}
              message={rescanMessage}
              onRescan={handleRescanLinkedIn}
            />
          )}

          {scoreLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}
            </div>
          ) : error ? (
            <p className="text-[14px] text-red-500">{error}</p>
          ) : score ? (
            <>
              {/* Score hero */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-5">
                  <ScoreRing score={score.score} verdict={score.verdict} />
                  <div className="flex-1">
                    <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">
                      Brand visibility score
                    </p>
                    <p className="text-[22px] font-bold text-slate-900">
                      {VERDICT_CONFIG[score.verdict as keyof typeof VERDICT_CONFIG]?.label ?? score.verdict}
                    </p>
                    {score.isEstimated && (
                      <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Estimated — connect LinkedIn for accuracy
                      </p>
                    )}
                  </div>
                  <ExternalLink className="h-4 w-4 text-slate-300" />
                </div>

                {/* Breakdown */}
                <div className="mt-5 pt-5 border-t border-slate-100 space-y-4">
                  <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">Score breakdown</p>
                  <BreakdownBar label="Activity" {...score.breakdown.activity} />
                  <BreakdownBar label="Profile completeness" {...score.breakdown.profileCompleteness} />
                  <BreakdownBar label="Social proof" {...score.breakdown.socialProof} />
                  <BreakdownBar label="Community presence" {...score.breakdown.communityPresence} />
                </div>
              </div>

              <WeeklyActions actions={weeklyActions} />

              {/* Audit items */}
              {auditItems.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
                        What to fix
                      </p>
                      <p className="mt-1 text-[13px] text-slate-500">Prioritized LinkedIn gaps from your current score.</p>
                    </div>
                    <span className="inline-flex w-fit items-center rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
                      {auditItems.length} item{auditItems.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {auditItems.map((item) => (
                      <AuditItem key={item.item_type} item={item} onAction={() => setTab("ideas")} />
                    ))}
                  </div>
                </div>
              )}

              {/* Manual update prompt */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">Profile signals</p>
                    <p className="mt-1 text-[14px] font-bold text-slate-900">Update LinkedIn data</p>
                  </div>
                  <p className="max-w-md text-[12px] leading-relaxed text-slate-400">
                    Manual values are used only when LinkedIn hides a field from the extension or public scan.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {MANUAL_PROFILE_FIELDS.map((field) => {
                    const Icon = field.Icon
                    const key = field.key
                    const value = ((profile as Record<string, unknown>)?.[key] as number | null) ?? 0

                    return (
                      <div key={`${key}-${value}`} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <label className="block text-[12px] font-bold text-slate-800">{field.label}</label>
                            <p className="mt-0.5 truncate text-[11px] text-slate-400">{field.helper}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex h-10 items-center rounded-lg border border-slate-200 bg-white transition focus-within:border-[var(--color-primary,#2563eb)] focus-within:ring-2 focus-within:ring-blue-50">
                          <input
                            type="number"
                            min={0}
                            aria-label={field.label}
                            defaultValue={value}
                            onBlur={async (e) => {
                              const val = parseInt(e.target.value, 10)
                              if (!isNaN(val)) {
                                const body: Record<string, number | string> = { [key]: val }
                                if (key === "days_since_last_activity") {
                                  body.last_post_detected_at = new Date(Date.now() - val * 86_400_000).toISOString()
                                }
                                await fetch("/api/brand/profile", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify(body),
                                })
                                loadProfile()
                                loadScore()
                              }
                            }}
                            className="min-w-0 flex-1 bg-transparent px-3 text-[17px] font-bold tabular-nums text-slate-950 outline-none"
                          />
                          <span className="shrink-0 pr-3 text-[11px] font-semibold text-slate-400">{field.suffix}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── Ideas tab ── */}
      {tab === "ideas" && (
        <div>
          {/* Source toggle */}
          <div className="mb-4 flex items-center gap-1 p-1 rounded-xl border border-slate-200 bg-white w-fit shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <button
              type="button"
              onClick={() => setIdeaSource("cv")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                ideaSource === "cv" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              )}
            >
              <Lightbulb className="h-3.5 w-3.5" />
              From my experience
            </button>
            <button
              type="button"
              onClick={() => setIdeaSource("trending")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                ideaSource === "trending" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              )}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Trending in my field
            </button>
          </div>

          <div className="flex items-center justify-between mb-5">
            <p className="text-[13px] text-slate-500">
              {ideaSource === "trending"
                ? "Hot topics and debates in your field — add your perspective"
                : "Content ideas specific to your experience and skills"}
            </p>
            <div className="flex items-center gap-2">
              <select
                value={toneForIdea}
                onChange={(e) => setToneForIdea(e.target.value as typeof toneForIdea)}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] bg-white outline-none focus:border-[var(--color-primary,#2563eb)]"
              >
                {TONE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={generatingIdeas}
                onClick={handleGenerateIdeas}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                  generatingIdeas ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800"
                )}
              >
                {generatingIdeas
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
                  : ideaSource === "trending"
                    ? <><TrendingUp className="h-3.5 w-3.5" />Find trending ideas</>
                    : <><Sparkles className="h-3.5 w-3.5" />Generate ideas</>
                }
              </button>
            </div>
          </div>

          {ideasLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />)}
            </div>
          ) : ideas.length === 0 ? (
            <div className="py-14 text-center">
              <div className={cn(
                "mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl",
                ideaSource === "trending" ? "bg-blue-50 text-blue-500" : "bg-amber-50 text-amber-500"
              )}>
                {ideaSource === "trending"
                  ? <TrendingUp className="h-6 w-6" />
                  : <Lightbulb className="h-6 w-6" />
                }
              </div>
              <p className="text-[14.5px] font-semibold text-slate-700 mb-1">No ideas yet</p>
              <p className="text-[13px] text-slate-500 mb-5">
                {ideaSource === "trending"
                  ? "Find trending topics in your field to post about"
                  : "Generate your first batch of ideas from your profile"}
              </p>
              <button
                type="button"
                disabled={generatingIdeas}
                onClick={handleGenerateIdeas}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary,#2563eb)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                {ideaSource === "trending"
                  ? <><TrendingUp className="h-4 w-4" />Find trending ideas in my field</>
                  : <><Sparkles className="h-4 w-4" />Generate 5 ideas from my profile</>
                }
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {ideas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  onWrite={handleWriteIdea}
                  onSkip={handleSkipIdea}
                  writing={writingIdeaId === idea.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Drafts tab ── */}
      {tab === "drafts" && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <p className="text-[13px] text-slate-500">Your generated drafts — copy and paste directly to LinkedIn</p>
          </div>

          {draftsLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-slate-100" />)}
            </div>
          ) : drafts.length === 0 ? (
            <div className="py-14 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <FileEdit className="h-6 w-6" />
              </div>
              <p className="text-[14.5px] font-semibold text-slate-700 mb-1">No drafts yet</p>
              <p className="text-[13px] text-slate-400 mb-4">Write a draft from an idea in the Content Ideas tab</p>
              <button type="button" onClick={() => setTab("ideas")} className="text-[13px] font-semibold text-[var(--color-primary,#2563eb)] hover:underline">
                Go to Content Ideas →
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {drafts.map((draft) => (
                <DraftCard key={draft.id} draft={draft} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
