"use client"

import { useCallback, useEffect, useState } from "react"
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

function MI({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return <span className={cn("material-icons select-none leading-none", className)} style={style} aria-hidden>{name}</span>
}

function fmtReach(min: number | null, max: number | null): string {
  if (!min || !max) return ""
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n)
  return `${fmt(min)}–${fmt(max)} reach`
}

const VERDICT_CONFIG = {
  strong:    { label: "Strong",    color: "#16a34a", bg: "#f0fdf4" },
  building:  { label: "Building",  color: "#d97706", bg: "#fffbeb" },
  low:       { label: "Low",       color: "#ea580c", bg: "#fff7ed" },
  invisible: { label: "Invisible", color: "#dc2626", bg: "#fef2f2" },
} as const

const SEVERITY_COLORS = { high: "text-red-500", medium: "text-amber-500", low: "text-slate-400" }

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
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: cfg.color }}>{cfg.label}</span>
      </div>
    </div>
  )
}

// ── Breakdown bar ─────────────────────────────────────────────────────────────

function BreakdownBar({ label, score, max, note }: { label: string; score: number; max: number; note: string }) {
  const pct = Math.round((score / max) * 100)
  const color = pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#94a3b8"

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-slate-700">{label}</span>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color }}>{score}/{max}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="text-[11px] text-slate-400">{note}</p>
    </div>
  )
}

// ── Audit item ────────────────────────────────────────────────────────────────

function AuditItem({ item }: { item: BrandAuditItem }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-[var(--color-border,#E2E8F0)] last:border-0">
      <MI
        name={item.material_icon}
        className={cn("text-[20px] mt-0.5 shrink-0", SEVERITY_COLORS[item.severity])}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-slate-900">{item.title}</p>
        <p className="text-[13px] text-slate-500 mt-0.5 leading-relaxed">{item.detail}</p>
        <p className="mt-1.5 text-[12px] font-medium text-[var(--color-primary,#2563eb)]">→ {item.fix_action}</p>
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
    <div className="border-b border-[var(--color-border,#E2E8F0)] pb-4 last:border-0">
      <div className="flex items-start justify-between gap-3 mb-1">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">
          {CONTENT_TYPE_LABELS[idea.content_type] ?? idea.content_type}
          {idea.best_day_to_post ? ` · Post ${idea.best_day_to_post}` : ""}
        </span>
        {(idea.estimated_reach_min || idea.estimated_reach_max) && (
          <span className="shrink-0 text-[11px] text-slate-400">{fmtReach(idea.estimated_reach_min, idea.estimated_reach_max)}</span>
        )}
      </div>
      <p className="text-[15px] font-semibold text-slate-900 mb-1">{idea.title}</p>
      <p className="text-[13px] text-slate-500 italic mb-2">"{idea.hook}"</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {idea.topic_tags.map((t) => (
          <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{t}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={writing}
          onClick={() => onWrite(idea)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
            writing ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800"
          )}
        >
          {writing ? <><MI name="sync" className="text-[13px] animate-spin" />Writing…</> : <><MI name="edit" className="text-[13px]" />Write this</>}
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
    <div className="border-b border-[var(--color-border,#E2E8F0)] pb-5 last:border-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">
          {CONTENT_TYPE_LABELS[draft.contentType] ?? draft.contentType} · {draft.tone}
        </span>
        <span className={cn("text-[11px] font-semibold tabular-nums", overLimit ? "text-red-500" : "text-slate-400")}>
          {draft.charCount}/{draft.charLimit}
        </span>
      </div>
      <p className="text-[14px] font-semibold text-slate-900 mb-2">{draft.title}</p>
      <pre className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap font-sans mb-3 max-h-48 overflow-y-auto">
        {draft.content}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-primary,#2563eb)] hover:underline"
      >
        <MI name={copied ? "check" : "content_copy"} className="text-[14px]" />
        {copied ? "Copied!" : "Copy to clipboard"}
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
    <div className="rounded-xl border border-slate-200 px-4 py-3 mb-5">
      <p className="text-[13px] font-semibold text-slate-700 mb-1">Add your LinkedIn URL to improve your score</p>
      <p className="text-[12px] text-slate-400 mb-3">We use it to estimate your profile completeness. No API connection required.</p>
      <div className="flex gap-2">
        <input
          type="url"
          placeholder="https://linkedin.com/in/yourname"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#2563eb)]"
        />
        <button
          type="button"
          disabled={saving || !url.trim()}
          onClick={save}
          className={cn("rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-colors",
            saving || !url.trim() ? "bg-slate-200 cursor-not-allowed" : "bg-[var(--color-primary,#2563eb)] hover:bg-blue-700"
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
  return (
    <div className="mb-6">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400 mb-3">This week's focus</p>
      <div className="space-y-2">
        {actions.map((a, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <MI
              name={a.type === "fix" ? "build" : a.type === "post" ? "edit_note" : "lightbulb"}
              className="text-[16px] mt-0.5 shrink-0 text-slate-400"
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-slate-700">{a.action}</p>
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

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "bar_chart" },
    { id: "ideas", label: "Content ideas", icon: "lightbulb" },
    { id: "drafts", label: "Drafts", icon: "edit_note" },
  ]

  return (
    <>
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />

      <div className="mx-auto max-w-2xl px-4 pb-12 sm:px-6">
        {/* Tab bar */}
        <div className="flex border-b border-[var(--color-border,#E2E8F0)] mb-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-[14px] font-medium transition-colors border-b-2 -mb-px",
                tab === t.id
                  ? "border-[var(--color-primary,#2563eb)] text-[var(--color-primary,#2563eb)]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              )}
            >
              <MI name={t.icon} className="text-[16px]" />
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
                {[...Array(3)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />)}
              </div>
            ) : error ? (
              <p className="text-[14px] text-red-500">{error}</p>
            ) : score ? (
              <>
                {/* Score hero */}
                <div className="flex items-center gap-6">
                  <ScoreRing score={score.score} verdict={score.verdict} />
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                      Brand visibility score
                    </p>
                    <p className="text-[22px] font-bold text-slate-900">
                      {VERDICT_CONFIG[score.verdict]?.label ?? score.verdict}
                    </p>
                    {score.isEstimated && (
                      <p className="text-[11px] text-amber-600 mt-1">
                        Estimated — connect LinkedIn or update manually for accuracy
                      </p>
                    )}
                  </div>
                </div>

                {/* Breakdown */}
                <div className="space-y-4">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">Score breakdown</p>
                  <BreakdownBar label="Activity" {...score.breakdown.activity} />
                  <BreakdownBar label="Profile completeness" {...score.breakdown.profileCompleteness} />
                  <BreakdownBar label="Social proof" {...score.breakdown.socialProof} />
                  <BreakdownBar label="Community presence" {...score.breakdown.communityPresence} />
                </div>

                <div className="border-t border-slate-100 pt-5">
                  <WeeklyActions actions={weeklyActions} />
                </div>

                {/* Audit items */}
                {auditItems.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400 mb-3">
                      What to fix ({auditItems.length})
                    </p>
                    <div className="divide-y divide-[var(--color-border,#E2E8F0)]">
                      {auditItems.map((item) => (
                        <AuditItem key={item.item_type} item={item} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Manual update prompt */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
                  <p className="text-[12px] font-semibold text-slate-600 mb-2">Update your profile data</p>
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
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] outline-none focus:border-[var(--color-primary,#2563eb)]"
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
              <div>
                <p className="text-[13px] text-slate-500">
                  Content ideas specific to your experience and skills
                </p>
              </div>
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
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                    generatingIdeas ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800"
                  )}
                >
                  {generatingIdeas
                    ? <><MI name="sync" className="text-[13px] animate-spin" />Generating…</>
                    : <><MI name="auto_awesome" className="text-[13px]" />Generate ideas</>
                  }
                </button>
              </div>
            </div>

            {ideasLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded bg-slate-100" />)}
              </div>
            ) : ideas.length === 0 ? (
              <div className="py-12 text-center">
                <MI name="lightbulb" className="text-[40px] text-slate-300 mb-3" />
                <p className="text-[14px] text-slate-500 mb-4">No ideas yet — generate your first batch</p>
                <button
                  type="button"
                  disabled={generatingIdeas}
                  onClick={handleGenerateIdeas}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary,#2563eb)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
                >
                  <MI name="auto_awesome" className="text-[14px]" />
                  Generate 5 ideas from my profile
                </button>
              </div>
            ) : (
              <div className="space-y-4">
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
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => <div key={i} className="h-32 animate-pulse rounded bg-slate-100" />)}
              </div>
            ) : drafts.length === 0 ? (
              <div className="py-12 text-center">
                <MI name="edit_note" className="text-[40px] text-slate-300 mb-3" />
                <p className="text-[14px] text-slate-500 mb-2">No drafts yet</p>
                <p className="text-[13px] text-slate-400">Write a draft from an idea in the Content Ideas tab</p>
                <button type="button" onClick={() => setTab("ideas")} className="mt-4 text-[13px] font-semibold text-[var(--color-primary,#2563eb)] hover:underline">
                  Go to Content Ideas →
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {drafts.map((draft) => (
                  <DraftCard key={draft.id} draft={draft} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
