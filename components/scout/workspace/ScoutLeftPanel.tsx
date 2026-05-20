"use client"

import { useEffect, useState } from "react"
import { Activity, Eye, Search, Layers, Zap, FileText, CheckCircle2, AlertCircle, Clock, Send, Bookmark } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ScoutTimelineEvent } from "@/lib/scout/timeline/types"

// ── Types ─────────────────────────────────────────────────────────────────────

type WatchlistEntry = {
  id: string
  name: string
  recentJobsCount: number
  lastJobPostedAt: string | null
}

type Props = {
  isActive: boolean
  recentEvents: ScoutTimelineEvent[]
  onCommand: (cmd: string) => void
  firstName?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

type ActivityLevel = "green" | "amber" | "gray"

function activityLevel(lastPostedAt: string | null, count: number): ActivityLevel {
  const days = daysSince(lastPostedAt)
  if (count > 0 && days !== null && days < 1) return "green"
  if (count > 0 && days !== null && days < 7) return "amber"
  return "gray"
}

function statusTooltip(lastPostedAt: string | null, count: number): string {
  const days = daysSince(lastPostedAt)
  if (count === 0 || days === null) return "Quiet for 7+ days"
  if (days === 0) return `${count} new role${count !== 1 ? "s" : ""} · posted today`
  if (days === 1) return `${count} new role${count !== 1 ? "s" : ""} · posted yesterday`
  if (days < 7)  return `${count} new role${count !== 1 ? "s" : ""} · posted ${days}d ago`
  return `Quiet for ${days} days`
}

// #1 Color-coded 7px dot — green=<24h, amber=<7d, gray=quiet
function StatusDot({ lastPostedAt, count }: { lastPostedAt: string | null; count: number }) {
  const level = activityLevel(lastPostedAt, count)
  return (
    <span
      title={statusTooltip(lastPostedAt, count)}
      className="flex-shrink-0 rounded-full"
      style={{
        width: 7, height: 7,
        backgroundColor: level === "green" ? "#22C55E" : level === "amber" ? "#F59E0B" : "#94A3B8",
        boxShadow: level === "green"
          ? "0 0 5px rgba(34,197,94,0.6)"
          : level === "amber"
            ? "0 0 4px rgba(245,158,11,0.5)"
            : "none",
      }}
    />
  )
}

// #1 Letter avatar — background subtly tints to match activity level
function CompanyAvatar({ name, level }: { name: string; level: ActivityLevel }) {
  const letter = name.trim()[0]?.toUpperCase() ?? "?"
  const tintClass =
    level === "green" ? "bg-green-50 text-green-700 ring-1 ring-green-200" :
    level === "amber" ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" :
    (() => {
      const colors = [
        "bg-violet-100 text-violet-700",
        "bg-blue-100 text-blue-700",
        "bg-emerald-100 text-emerald-700",
        "bg-orange-100 text-orange-700",
        "bg-pink-100 text-pink-700",
        "bg-cyan-100 text-cyan-700",
        "bg-indigo-100 text-indigo-700",
      ]
      return colors[letter.charCodeAt(0) % colors.length]
    })()
  return (
    <span className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${tintClass}`}>
      {letter}
    </span>
  )
}

// #4 Content-based icon — matches on action title text
function actionIconFor(title: string): { Icon: LucideIcon; color: string } {
  const t = title.toLowerCase()
  if (t.includes("bulk application") || t.includes("opened application"))
    return { Icon: Send,         color: "text-orange-400" }
  if (t.includes("apply") || t.includes("applied") || t.includes("submitted"))
    return { Icon: CheckCircle2, color: "text-green-500" }
  if (t.includes("search") || t.includes("filter") || t.includes("found"))
    return { Icon: Search,       color: "text-blue-400" }
  if (t.includes("resume") || t.includes("tailor"))
    return { Icon: FileText,     color: "text-purple-400" }
  if (t.includes("saved") || t.includes("watchlist"))
    return { Icon: Bookmark,     color: "text-amber-400" }
  return { Icon: Zap,            color: "text-slate-400" }
}

// Keep type-based fallback for non-title events
const _EVENT_ICON_FALLBACK: Partial<Record<ScoutTimelineEvent["type"], LucideIcon>> = {
  workspace_change:  Layers,
  workflow_started:  Zap,
  workflow_step:     Zap,
  error:             AlertCircle,
}
void _EVENT_ICON_FALLBACK // suppress unused-variable lint

// ── Component ─────────────────────────────────────────────────────────────────

export function ScoutLeftPanel({ isActive, recentEvents, onCommand, firstName }: Props) {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch("/api/watchlist?limit=8")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.watchlist) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setWatchlist(data.watchlist.map((w: any) => ({
            id: w.company?.id ?? w.companyId ?? String(Math.random()),
            name: w.company?.name ?? "Company",
            recentJobsCount: w.recent_jobs_count ?? 0,
            lastJobPostedAt: w.last_job_posted_at ?? null,
          })))
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const displayEvents = recentEvents.slice(0, 5)

  return (
    <aside className="flex h-full w-[240px] flex-shrink-0 flex-col overflow-hidden border-r border-slate-100 bg-white">

      {/* ── Monitoring ── */}
      <div className="border-b border-slate-100 px-4 py-3.5">
        <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
          <Eye className="h-3 w-3" />
          Monitoring
        </p>
        <div className="space-y-2">
          {!loaded ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-slate-100" />
                <div className="h-3.5 flex-1 animate-pulse rounded bg-slate-100" style={{ opacity: 1 - i * 0.2 }} />
              </div>
            ))
          ) : watchlist.length === 0 ? (
            <p className="text-[11px] italic text-slate-400">Add companies to your watchlist</p>
          ) : (
            watchlist.map((c) => {
              const level = activityLevel(c.lastJobPostedAt, c.recentJobsCount)
              return (
                <div key={c.id} className="group flex items-center gap-2">
                  <StatusDot lastPostedAt={c.lastJobPostedAt} count={c.recentJobsCount} />
                  <CompanyAvatar name={c.name} level={level} />
                  <span className="flex-1 truncate text-[12px] text-slate-600">{c.name}</span>
                  {c.recentJobsCount > 0 && (
                    <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${
                      level === "green" ? "bg-green-50 text-green-600" :
                      level === "amber" ? "bg-amber-50 text-amber-600" :
                      "bg-slate-50 text-slate-500"
                    }`}>
                      {c.recentJobsCount}
                    </span>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Recent actions ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3.5">
        <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
          <Activity className="h-3 w-3" />
          Recent Actions
        </p>
        <div className="space-y-3">
          {displayEvents.length === 0 ? (
            <p className="text-[11px] italic text-slate-400">No actions this session</p>
          ) : (
            displayEvents.map((ev, idx) => {
              const { Icon, color } = actionIconFor(ev.title)
              return (
                /* #2D slide-in only for the newest item (idx 0) */
                <div
                  key={ev.id}
                  className={`flex items-start gap-2 ${idx === 0 ? "animate-[scout-slide-in_0.3s_ease-out_both]" : ""}`}
                >
                  <span className={`mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${idx === 0 ? "bg-[#FF5C18]" : "bg-slate-200"}`} />
                  <Icon className={`mt-0.5 h-3 w-3 flex-shrink-0 ${color}`} />
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] leading-4 text-slate-600">
                      {ev.title}
                    </p>
                    <p className="text-[10px] text-slate-400">{timeAgo(ev.timestamp)}</p>
                  </div>
                </div>
              )
            })
          )}
        </div>
        {recentEvents.length > 5 && (
          <p className="mt-3 text-[10px] font-medium text-[#FF5C18] hover:underline cursor-pointer">
            View full timeline →
          </p>
        )}
      </div>

      {/* ── Quick commands ── */}
      <div className="border-t border-slate-100 px-4 py-3">
        <div className="space-y-1">
          {/* #3 Quick commands — 16px icons, slate-100 hover, text-[12px] */}
          {[
            { label: "Find matching jobs",  cmd: "Find me matching jobs",              Icon: Search   },
            { label: "Compare saved jobs",  cmd: "Compare my saved jobs",              Icon: Layers   },
            { label: "Resume strategy",     cmd: "What should I improve on my resume?",Icon: FileText },
          ].map(({ label, cmd, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => onCommand(cmd)}
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-all duration-150 hover:bg-slate-100"
            >
              <Icon className="h-4 w-4 flex-shrink-0 text-slate-400 transition-colors duration-150 group-hover:text-slate-900" />
              <span className="truncate text-[12px] text-slate-600 transition-colors duration-150 group-hover:text-slate-900">
                {label}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
          <span className="text-[10px] text-slate-400">Command palette</span>
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">⌘K</kbd>
        </div>
      </div>
    </aside>
  )
}
