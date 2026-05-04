"use client"

import { useEffect, useState } from "react"
import { Activity, Eye, Search, Layers, Zap, FileText, CheckCircle2, AlertCircle, Clock } from "lucide-react"
import type { ScoutTimelineEvent } from "@/lib/scout/timeline/types"
import { ScoutOrb } from "@/components/scout/ScoutOrb"

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

// Color-coded dot: green = <1d, amber = <7d, gray = quiet
function StatusDot({ lastPostedAt, count }: { lastPostedAt: string | null; count: number }) {
  const days = daysSince(lastPostedAt)
  const isGreen = count > 0 && days !== null && days < 1
  const isAmber = count > 0 && (!isGreen)
  const tooltip = count > 0
    ? `${count} new role${count !== 1 ? "s" : ""} — ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`}`
    : "No recent activity"

  return (
    <span
      title={tooltip}
      className={`h-2 w-2 flex-shrink-0 rounded-full transition-colors ${
        isGreen ? "bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.7)]" :
        isAmber ? "bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.6)]" :
        "bg-slate-200"
      }`}
    />
  )
}

// Colored letter avatar for companies without logos
function CompanyAvatar({ name }: { name: string }) {
  const letter = name.trim()[0]?.toUpperCase() ?? "?"
  const colors = [
    "bg-violet-100 text-violet-700",
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-orange-100 text-orange-700",
    "bg-pink-100 text-pink-700",
    "bg-cyan-100 text-cyan-700",
    "bg-indigo-100 text-indigo-700",
  ]
  const color = colors[letter.charCodeAt(0) % colors.length]
  return (
    <span className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${color}`}>
      {letter}
    </span>
  )
}

// Icon per event type
const EVENT_ICON: Partial<Record<ScoutTimelineEvent["type"], typeof Search>> = {
  command:           Search,
  workspace_change:  Layers,
  workflow_started:  Zap,
  workflow_step:     Zap,
  research_started:  Search,
  manual_submit:     CheckCircle2,
  error:             AlertCircle,
}

const DEFAULT_EVENT_ICON = Clock

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

      {/* ── Identity ── */}
      <div className="border-b border-slate-100 px-4 py-4">
        <div className="flex items-center gap-3">
          <ScoutOrb size="sm" state={isActive ? "thinking" : "idle"} />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-tight text-slate-900">
              Scout{firstName ? <span className="font-normal text-slate-400"> · {firstName}</span> : null}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full transition-colors ${isActive ? "bg-[#FF5C18] animate-pulse" : "bg-emerald-400"}`} />
              <p className="text-[11px] text-slate-400">
                {isActive ? "Working…" : "Watching"}
              </p>
            </div>
          </div>
        </div>
      </div>

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
            watchlist.map((c) => (
              <div key={c.id} className="group flex items-center gap-2">
                <StatusDot lastPostedAt={c.lastJobPostedAt} count={c.recentJobsCount} />
                <CompanyAvatar name={c.name} />
                <span className="flex-1 truncate text-[12px] text-slate-600">{c.name}</span>
                {c.recentJobsCount > 0 && (
                  <span className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-bold text-emerald-600">
                    {c.recentJobsCount}
                  </span>
                )}
              </div>
            ))
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
            displayEvents.map((ev) => {
              const Icon = EVENT_ICON[ev.type] ?? DEFAULT_EVENT_ICON
              return (
                <div key={ev.id} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#FF5C18]/60" />
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
          {[
            { label: "Find matching jobs",  cmd: "Find me matching jobs",        Icon: Search },
            { label: "Compare saved jobs",  cmd: "Compare my saved jobs",        Icon: Layers },
            { label: "Resume strategy",     cmd: "What should I improve on my resume?", Icon: FileText },
          ].map(({ label, cmd, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => onCommand(cmd)}
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-50"
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-colors group-hover:text-[#FF5C18]" />
              <span className="truncate text-[11.5px] text-slate-500 transition-colors group-hover:text-slate-800">
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
