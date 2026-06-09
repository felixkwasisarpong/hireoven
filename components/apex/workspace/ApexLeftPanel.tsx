"use client"

import { useEffect, useState } from "react"
import { Activity, Eye, Search, Layers, FileText, CheckCircle2, Send, Bookmark, Target, Zap } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ApexTimelineEvent } from "@/lib/apex/timeline/types"

// ── Types ─────────────────────────────────────────────────────────────────────

type WatchlistEntry = {
  id: string
  name: string
  recentJobsCount: number
  lastJobPostedAt: string | null
}

type Props = {
  isActive: boolean
  recentEvents: ApexTimelineEvent[]
  onCommand: (cmd: string) => void
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

function StatusDot({ lastPostedAt, count }: { lastPostedAt: string | null; count: number }) {
  const level = activityLevel(lastPostedAt, count)
  const color  = level === "green" ? "#22c55e" : level === "amber" ? "#0ea5e9" : "#94a3b8"
  const glow   = level === "green"
    ? "0 0 6px rgba(34,197,94,0.55)"
    : level === "amber"
      ? "0 0 5px rgba(14,165,233,0.55)"
      : "none"
  return (
    <span
      title={statusTooltip(lastPostedAt, count)}
      className="flex-shrink-0 rounded-full"
      style={{ width: 6, height: 6, backgroundColor: color, boxShadow: glow }}
    />
  )
}

function CompanyAvatar({ name, level }: { name: string; level: ActivityLevel }) {
  const letter = name.trim()[0]?.toUpperCase() ?? "?"
  const cls =
    level === "green" ? "bg-green-500/15 text-green-400 ring-1 ring-green-400/20" :
    level === "amber" ? "bg-sky-500/15 text-sky-500 ring-1 ring-sky-500/20" :
    (() => {
      const palette = [
        "bg-violet-500/15 text-violet-400",
        "bg-blue-500/15 text-blue-400",
        "bg-emerald-500/15 text-emerald-400",
        "bg-cyan-500/15 text-cyan-500",
        "bg-pink-500/15 text-pink-400",
        "bg-cyan-500/15 text-cyan-400",
        "bg-slate-500/15 text-slate-400",
      ]
      return palette[letter.charCodeAt(0) % palette.length]
    })()
  return (
    <span className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${cls}`}>
      {letter}
    </span>
  )
}

function actionIconFor(title: string): { Icon: LucideIcon; color: string } {
  const t = title.toLowerCase()
  if (t.includes("bulk application") || t.includes("opened application"))
    return { Icon: Send,         color: "text-blue-500" }
  if (t.includes("apply") || t.includes("applied") || t.includes("submitted"))
    return { Icon: CheckCircle2, color: "text-emerald-400" }
  if (t.includes("search") || t.includes("filter") || t.includes("found"))
    return { Icon: Search,       color: "text-blue-400" }
  if (t.includes("resume") || t.includes("tailor"))
    return { Icon: FileText,     color: "text-violet-400" }
  if (t.includes("saved") || t.includes("watchlist"))
    return { Icon: Bookmark,     color: "text-slate-400" }
  return { Icon: Zap,            color: "text-slate-300" }
}

function SectionLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
      <Icon className="h-3 w-3" />
      {label}
    </p>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ApexLeftPanel({ isActive, recentEvents, onCommand }: Props) {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch("/api/watchlist?limit=8")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.watchlist) {
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

  const activeWatchCount = watchlist.filter((entry) => entry.recentJobsCount > 0).length
  const displayWatchlist = watchlist.slice(0, 4)
  const displayEvents = recentEvents.slice(0, 3)
  const quickCommands = [
    { label: "Hunt", cmd: "Run autonomous hunt for today", Icon: Target },
    { label: "Find jobs", cmd: "Find me matching jobs", Icon: Search },
    { label: "Compare", cmd: "Compare my saved jobs", Icon: Layers },
    { label: "Resume", cmd: "What should I improve on my resume?", Icon: FileText },
  ]

  return (
    <aside className="hidden h-full w-[216px] flex-shrink-0 flex-col overflow-hidden border-r border-slate-200/70 bg-[linear-gradient(180deg,#FAFCFF_0%,#F8FAFC_100%)] xl:flex">
      <div className="border-b border-slate-200/70 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionLabel icon={Eye} label="Signal Watch" />
            <p className="mt-2 text-[13px] font-semibold leading-5 text-slate-900">
              {loaded
                ? `${activeWatchCount} active target${activeWatchCount === 1 ? "" : "s"}`
                : "Watching your target companies"}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              Quiet monitoring on the side. Apex surfaces movement without turning this rail into the main event.
            </p>
          </div>
          {isActive && (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
              Live
            </span>
          )}
        </div>
        <div className="mt-4 space-y-2.5">
          {!loaded ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-slate-300/80" />
                <div className="h-3.5 flex-1 animate-pulse rounded bg-slate-200/80" style={{ opacity: 1 - i * 0.25 }} />
              </div>
            ))
          ) : displayWatchlist.length === 0 ? (
            <p className="text-[11px] italic text-slate-400">Add companies to your watchlist</p>
          ) : (
            displayWatchlist.map((c) => {
              const level = activityLevel(c.lastJobPostedAt, c.recentJobsCount)
              return (
                <div key={c.id} className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/90 px-2.5 py-2">
                  <StatusDot lastPostedAt={c.lastJobPostedAt} count={c.recentJobsCount} />
                  <CompanyAvatar name={c.name} level={level} />
                  <span className="flex-1 truncate text-[11.5px] text-slate-600">{c.name}</span>
                  {c.recentJobsCount > 0 && (
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                      level === "green" ? "bg-green-500/15 text-green-500" :
                      level === "amber" ? "bg-sky-500/15 text-sky-600" :
                      "bg-slate-200/80 text-slate-500"
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

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <SectionLabel icon={Activity} label="Session Pulse" />
        <div className="mt-3 space-y-3">
          {displayEvents.length === 0 ? (
            <p className="text-[11px] italic text-slate-400">No actions this session</p>
          ) : (
            displayEvents.map((ev, idx) => {
              const { Icon, color } = actionIconFor(ev.title)
              return (
                <div
                  key={ev.id}
                  className={`rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-3 ${idx === 0 ? "animate-[apex-slide-in_0.3s_ease-out_both]" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        idx === 0
                          ? "bg-blue-600 shadow-[0_0_5px_rgba(37,99,235,0.45)]"
                          : "bg-slate-300"
                      }`}
                    />
                    <Icon className={`mt-0.5 h-3 w-3 flex-shrink-0 ${color}`} />
                    <div className="min-w-0">
                      <p className="text-[11.5px] leading-5 text-slate-700">{ev.title}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{timeAgo(ev.timestamp)}</p>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="border-t border-slate-200/70 px-4 py-4">
        <SectionLabel icon={Zap} label="Launch" />
        <div className="mt-3 space-y-1.5">
          {quickCommands.map(({ label, cmd, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => onCommand(cmd)}
              className="group flex w-full items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 text-left transition-all duration-150 hover:border-blue-200 hover:bg-blue-50/70"
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-colors group-hover:text-blue-600" />
              <span className="truncate text-[12px] text-slate-500 transition-colors group-hover:text-slate-800">
                {label}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-[10px] text-slate-400">Open command palette</span>
          <kbd className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">⌘K</kbd>
        </div>
      </div>
    </aside>
  )
}
