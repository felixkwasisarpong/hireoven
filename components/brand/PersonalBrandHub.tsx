"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  FileEdit,
  Info,
  Lightbulb,
  Loader2,
  Pencil,
  Sparkles,
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
  visibility_score: number
  posting_frequency_target: number
  communities_active: number
  recommendations_count: number | null
  estimated_connections: number | null
  has_about_section: boolean | null
  headline: string | null
  days_since_last_activity: number | null
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

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  high:   <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-red-500" />,
  medium: <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-500" />,
  low:    <Info className="h-5 w-5 mt-0.5 shrink-0 text-slate-400" />,
}

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

function AuditItem({ item }: { item: BrandAuditItem }) {
  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-slate-100 last:border-0">
      {SEVERITY_ICON[item.severity] ?? <Info className="h-5 w-5 mt-0.5 shrink-0 text-slate-400" />}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-slate-900">{item.title}</p>
        <p className="text-[13px] text-slate-500 mt-0.5 leading-relaxed">{item.detail}</p>
        <p className="mt-1.5 text-[12px] font-semibold text-[var(--color-primary,#2563eb)]">→ {item.fix_action}</p>
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
  const [error, setError] = useState<string | null>(null)

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
      const r = await fetch("/api/brand/ideas", { method: "POST" })
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

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
    { id: "ideas", label: "Content ideas", icon: <Lightbulb className="h-4 w-4" /> },
    { id: "drafts", label: "Drafts", icon: <FileEdit className="h-4 w-4" /> },
  ]

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 sm:px-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-3 text-[13.5px] font-medium transition-colors border-b-2 -mb-px",
              tab === t.id
                ? "border-[var(--color-primary,#2563eb)] text-[var(--color-primary,#2563eb)]"
                : "border-transparent text-slate-500 hover:text-slate-800"
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
            <LinkedInPrompt onSave={(url) => setProfile((p) => p ? { ...p, linkedin_url: url } : null)} />
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
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
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
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400 mb-1">
                    What to fix
                  </p>
                  <p className="text-[12px] text-slate-400 mb-4">{auditItems.length} item{auditItems.length !== 1 ? "s" : ""}</p>
                  <div>
                    {auditItems.map((item) => (
                      <AuditItem key={item.item_type} item={item} />
                    ))}
                  </div>
                </div>
              )}

              {/* Manual update prompt */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-4">
                <p className="text-[12.5px] font-semibold text-slate-600 mb-3">Update your profile data</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: "Recommendations", key: "recommendations_count", type: "number" },
                    { label: "Connections", key: "estimated_connections", type: "number" },
                    { label: "Communities active", key: "communities_active", type: "number" },
                  ].map(({ label, key, type }) => (
                    <div key={key}>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">{label}</label>
                      <input
                        type={type}
                        min={0}
                        defaultValue={(profile as Record<string, unknown>)?.[key] as number ?? ""}
                        onBlur={async (e) => {
                          const val = parseInt(e.target.value, 10)
                          if (!isNaN(val)) {
                            await fetch("/api/brand/profile", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ [key]: val }),
                            })
                            loadScore()
                          }
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-[var(--color-primary,#2563eb)]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── Ideas tab ── */}
      {tab === "ideas" && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <p className="text-[13px] text-slate-500">
              Content ideas specific to your experience and skills
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
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
                <Lightbulb className="h-6 w-6" />
              </div>
              <p className="text-[14.5px] font-semibold text-slate-700 mb-1">No ideas yet</p>
              <p className="text-[13px] text-slate-500 mb-5">Generate your first batch of ideas from your profile</p>
              <button
                type="button"
                disabled={generatingIdeas}
                onClick={handleGenerateIdeas}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary,#2563eb)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                Generate 5 ideas from my profile
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
