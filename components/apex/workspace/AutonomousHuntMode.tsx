"use client"

import Link from "next/link"
import {
  ArrowRight,
  Briefcase,
  Crosshair,
  Flame,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Target,
  TimerReset,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ApexAutonomousHuntPlan, ApexHuntAction, ApexHuntQueueItem, ApexHuntTrack } from "@/lib/apex/hunt/types"

type Props = {
  data: ApexAutonomousHuntPlan | null
  loading: boolean
  error: string | null
  onCommand: (query: string) => void
  onRefresh: () => void
}

function urgencyClasses(urgency: ApexHuntAction["urgency"]) {
  if (urgency === "now") return "border-red-200 bg-red-50 text-red-700"
  if (urgency === "today") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-slate-200 bg-slate-100 text-slate-600"
}

function postureClasses(posture: ApexAutonomousHuntPlan["posture"]) {
  if (posture === "narrow") return "border-amber-200 bg-amber-50 text-amber-800"
  if (posture === "aggressive") return "border-red-200 bg-red-50 text-red-800"
  return "border-blue-200 bg-blue-50 text-blue-800"
}

function trackClasses(posture: ApexHuntTrack["posture"]) {
  if (posture === "primary") return "border-slate-900 bg-slate-950 text-white"
  if (posture === "secondary") return "border-blue-200 bg-blue-50 text-blue-800"
  return "border-slate-200 bg-slate-50 text-slate-700"
}

function workModeLabel(item: ApexHuntQueueItem): string {
  if (item.workMode === "remote") return "Remote"
  if (item.workMode === "hybrid") return "Hybrid"
  return "On-site"
}

function freshnessLabel(hours: number): string {
  if (hours < 24) return `${hours}h old`
  const days = Math.max(1, Math.round(hours / 24))
  return `${days}d old`
}

function ActionRow({ action, onCommand }: { action: ApexHuntAction; onCommand: (query: string) => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">{action.title}</p>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em]", urgencyClasses(action.urgency))}>
              {action.urgency}
            </span>
          </div>
          <p className="mt-1.5 text-[12px] leading-5 text-slate-600">{action.why}</p>
        </div>
        <button
          type="button"
          onClick={() => onCommand(action.query)}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-slate-800"
        >
          Run now
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function TrackRow({ track, onCommand }: { track: ApexHuntTrack; onCommand: (query: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCommand(track.query)}
      className={cn("w-full rounded-2xl border px-4 py-4 text-left transition hover:-translate-y-[1px]", trackClasses(track.posture))}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{track.title}</p>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">{track.posture}</span>
      </div>
      <p className="mt-2 text-[12px] leading-5 opacity-95">{track.thesis}</p>
      <p className="mt-1 text-[11px] leading-5 opacity-75">{track.reason}</p>
    </button>
  )
}

function QueueRow({ item, onCommand }: { item: ApexHuntQueueItem; onCommand: (query: string) => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={item.jobHref} className="truncate text-sm font-semibold text-slate-900 transition hover:text-blue-700">
              {item.title}
            </Link>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              Hunt {item.queueScore}
            </span>
            {item.matchScore !== null && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                Match {item.matchScore}
              </span>
            )}
            {item.sponsorshipScore >= 70 && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                Sponsor-friendly
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
            {item.companyHref ? (
              <Link href={item.companyHref} className="font-medium text-slate-700 transition hover:text-blue-700">
                {item.companyName}
              </Link>
            ) : (
              <span className="font-medium text-slate-700">{item.companyName}</span>
            )}
            <span>·</span>
            <span>{item.location ?? "Location flexible"}</span>
            <span>·</span>
            <span>{workModeLabel(item)}</span>
            <span>·</span>
            <span>{freshnessLabel(item.freshnessHours)}</span>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-slate-600">{item.reason}</p>
        </div>
        <button
          type="button"
          onClick={() => onCommand(item.feedQuery)}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
        >
          Search similar
          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </div>
    </div>
  )
}

export function AutonomousHuntMode({ data, loading, error, onCommand, onRefresh }: Props) {
  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[#2563EB]" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Building your autonomous hunt plan…</p>
            <p className="mt-0.5 text-xs text-slate-500">Ranking live opportunities, execution pressure, and constraints.</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-100 bg-slate-50" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-100 bg-slate-50" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-5">
        <p className="text-sm font-semibold text-red-700">Autonomous Hunt failed</p>
        <p className="mt-1 text-xs leading-5 text-red-600">{error}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            Retry hunt plan
          </button>
          <button
            type="button"
            onClick={() => onCommand("Run autonomous hunt for today")}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Run default hunt
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white px-6 py-6 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-[#2563EB]" />
          <p className="text-sm font-semibold text-slate-900">Autonomous Hunt</p>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Ask Apex to build a live attack plan around your lane, execution rhythm, and the strongest fresh opportunities.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            "Run autonomous hunt for today",
            "Run autonomous hunt for sponsorship-friendly roles matching my profile",
            "Build my attack plan for this week",
          ].map((query) => (
            <button
              key={query}
              type="button"
              onClick={() => onCommand(query)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-900 hover:bg-slate-950 hover:text-white"
            >
              {query}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_38px_rgba(15,23,42,0.08)] sm:px-6 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                <Crosshair className="h-3 w-3" />
                Autonomous Hunt
              </span>
              <span className={cn("rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]", postureClasses(data.posture))}>
                {data.posture} posture
              </span>
              {data.targetLane && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-700">
                  {data.targetLane}
                </span>
              )}
            </div>
            <p className="mt-4 text-[22px] font-semibold leading-tight tracking-tight text-slate-950 sm:text-[28px]">
              {data.summary}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{data.operatingRule}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh plan
            </button>
            <button
              type="button"
              onClick={() => onCommand("Run autonomous hunt for today")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-slate-800"
            >
              <Zap className="h-3.5 w-3.5" />
              Rerun hunt
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Pipeline</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{data.signals.activeApplications}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">active applications</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Queue lead</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{data.signals.topQueueScore ?? "--"}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">top hunt score</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Execution</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{data.signals.executionDoneCount7d}/{Math.max(1, data.signals.executionDoneCount7d + data.signals.executionDeferredCount7d)}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">done vs deferred in 7d</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Sponsor queue</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{data.signals.freshSponsorCount}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">fresh sponsor-friendly leads</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.02fr_0.98fr]">
        <div className="space-y-5">
          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_38px_rgba(15,23,42,0.08)] sm:px-6 sm:py-6">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-[#2563EB]" />
              <p className="text-sm font-semibold text-slate-900">Attack Plan</p>
            </div>
            <div className="mt-4 space-y-3">
              {data.attackPlan.map((action) => (
                <ActionRow key={action.id} action={action} onCommand={onCommand} />
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_38px_rgba(15,23,42,0.08)] sm:px-6 sm:py-6">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-[#2563EB]" />
              <p className="text-sm font-semibold text-slate-900">Why Apex is pushing this now</p>
            </div>
            <div className="mt-4 space-y-2.5">
              {data.whyNow.map((item) => (
                <div key={item} className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-blue-600" />
                  <p className="text-[12px] leading-5 text-slate-700">{item}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_38px_rgba(15,23,42,0.08)] sm:px-6 sm:py-6">
            <div className="flex items-center gap-2">
              <TimerReset className="h-4 w-4 text-[#2563EB]" />
              <p className="text-sm font-semibold text-slate-900">Hunt Tracks</p>
            </div>
            <div className="mt-4 space-y-3">
              {data.tracks.map((track) => (
                <TrackRow key={track.id} track={track} onCommand={onCommand} />
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_38px_rgba(15,23,42,0.08)] sm:px-6 sm:py-6">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-[#2563EB]" />
              <p className="text-sm font-semibold text-slate-900">Priority Queue</p>
            </div>
            <div className="mt-4 space-y-3">
              {data.queue.length > 0 ? (
                data.queue.map((item) => (
                  <QueueRow key={item.id} item={item} onCommand={onCommand} />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-400">
                  Apex needs more fresh scored jobs to build a sharper queue.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_38px_rgba(15,23,42,0.08)] sm:px-6 sm:py-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
              <p className="text-sm font-semibold text-slate-900">Guardrails</p>
            </div>
            <div className="mt-4 space-y-2.5">
              {data.guardrails.map((item) => (
                <div key={item} className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-slate-500" />
                  <p className="text-[12px] leading-5 text-slate-700">{item}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
