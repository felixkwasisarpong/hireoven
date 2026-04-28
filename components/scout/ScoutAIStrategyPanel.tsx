"use client"

import {
  AlertOctagon,
  ArrowUpCircle,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
  Star,
  Target,
  Zap,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { getDefaultActionLabel } from "@/lib/scout/actions"
import type { ScoutAction, ScoutAIStrategy, ScoutAIStrategyGated } from "@/lib/scout/types"
import { useScoutActionExecutor } from "./useScoutActionExecutor"

type StrategyAPIResponse = {
  strategy: ScoutAIStrategy
  gated: ScoutAIStrategyGated | null
  isPremium: boolean
  error?: string
}

type SectionConfig = {
  key: keyof Omit<ScoutAIStrategy, "actions">
  label: string
  icon: React.ElementType
  iconBg: string
  iconColor: string
  accentBar: string
  badgeColor: string
}

const SECTIONS: SectionConfig[] = [
  {
    key: "focus",
    label: "Focus",
    icon: Target,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    accentBar: "bg-blue-500",
    badgeColor: "bg-blue-100 text-blue-800",
  },
  {
    key: "prioritize",
    label: "Prioritize",
    icon: Star,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    accentBar: "bg-emerald-500",
    badgeColor: "bg-emerald-100 text-emerald-800",
  },
  {
    key: "avoid",
    label: "Avoid",
    icon: AlertOctagon,
    iconBg: "bg-red-50",
    iconColor: "text-red-500",
    accentBar: "bg-red-400",
    badgeColor: "bg-red-100 text-red-800",
  },
  {
    key: "improve",
    label: "Improve",
    icon: ArrowUpCircle,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
    accentBar: "bg-amber-400",
    badgeColor: "bg-amber-100 text-amber-800",
  },
]

function SectionCard({
  config,
  items,
  locked,
  onUnlock,
}: {
  config: SectionConfig
  items: string[]
  locked: boolean
  onUnlock: () => void
}) {
  const Icon = config.icon

  return (
    <article className="relative overflow-hidden rounded-[18px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.04)]">
      {/* accent bar */}
      <div className={`absolute left-0 top-4 h-8 w-1 rounded-r-full ${config.accentBar}`} />

      <div className="pl-2">
        <div className="flex items-center gap-2">
          <div
            className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl ${config.iconBg}`}
          >
            <Icon className={`h-3.5 w-3.5 ${config.iconColor}`} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            {config.label}
          </p>
        </div>

        {locked ? (
          <div className="mt-4">
            {/* Blurred placeholder rows */}
            <div className="space-y-2 select-none pointer-events-none" aria-hidden>
              {["████████████████", "███████████████████", "████████████"].map((s, i) => (
                <div key={i} className="flex items-start gap-2 opacity-20">
                  <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
                  <span className="text-sm text-slate-400 blur-[3px]">{s}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onUnlock}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
            >
              <Lock className="h-3 w-3" />
              Unlock {config.label}
            </button>
          </div>
        ) : items.length > 0 ? (
          <ul className="mt-4 space-y-2.5">
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-[5px] inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-300" />
                <span className="text-sm leading-6 text-slate-700">{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-400">No specific signals for this section.</p>
        )}
      </div>
    </article>
  )
}

function ThisWeekCard({ items }: { items: string[] }) {
  return (
    <article className="rounded-[18px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2">
        <div className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-orange-50">
          <CalendarDays className="h-3.5 w-3.5 text-orange-600" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          This Week
        </p>
      </div>

      {items.length > 0 ? (
        <ol className="mt-4 space-y-3">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-[10px] font-bold text-orange-700">
                {i + 1}
              </div>
              <span className="text-sm leading-6 text-slate-700">{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-slate-400">
          No specific tasks this week — complete profile setup first.
        </p>
      )}
    </article>
  )
}

function ActionsCard({
  actions,
  onExecute,
  feedback,
}: {
  actions: ScoutAction[]
  onExecute: (action: ScoutAction) => void
  feedback: string | null
}) {
  if (actions.length === 0) return null

  return (
    <article className="rounded-[18px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2">
        <div className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-[#ea580c]/10">
          <Zap className="h-3.5 w-3.5 text-[#ea580c]" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Quick Actions
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((action, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onExecute(action)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#ea580c]/20 hover:bg-[#ea580c]/5 hover:text-[#ea580c]"
          >
            {action.label ?? getDefaultActionLabel(action as ScoutAction)}
          </button>
        ))}
      </div>

      {feedback && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
          {feedback}
        </div>
      )}
    </article>
  )
}

type ScoutAIStrategyPanelProps = {
  /** Optional ref — parent can store the trigger fn and call it externally */
  triggerRef?: React.MutableRefObject<(() => void) | null>
}

/**
 * AI-powered weekly strategy panel for Scout.
 * User-initiated — never auto-refreshes. Gated by scout_strategy feature.
 */
export function ScoutAIStrategyPanel({ triggerRef }: ScoutAIStrategyPanelProps = {}) {
  const { showUpgrade } = useUpgradeModal()
  const { executeAction, feedback } = useScoutActionExecutor()

  const [strategy, setStrategy] = useState<ScoutAIStrategy | null>(null)
  const [gated, setGated] = useState<ScoutAIStrategyGated | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)

  // Stable fn ref so the parent can call generateStrategy via triggerRef
  const generateStrategyRef = useRef<() => void>(() => {})

  async function generateStrategy() {
    if (isLoading) return
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/scout/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath: "/dashboard/scout" }),
        cache: "no-store",
      })

      const data = (await res.json().catch(() => null)) as StrategyAPIResponse | null

      if (!res.ok || !data) {
        setError(data?.error ?? "Scout couldn't generate a strategy right now. Please try again.")
        return
      }

      setStrategy(data.strategy)
      setGated(data.gated ?? null)
      setGeneratedAt(new Date())
    } catch {
      setError("Network error. Please check your connection and try again.")
    } finally {
      setIsLoading(false)
    }
  }

  // Keep refs in sync after every render
  generateStrategyRef.current = generateStrategy
  useEffect(() => {
    if (triggerRef) triggerRef.current = () => generateStrategyRef.current()
  })

  const isLocked = (key: SectionConfig["key"]) =>
    !!gated?.lockedSections.includes(key as "prioritize" | "avoid" | "improve")

  return (
    <section className="space-y-4">
      {/* ── Panel header ── */}
      <div className="rounded-[20px] border border-slate-200/80 bg-white px-6 py-5 shadow-[0_2px_16px_rgba(15,23,42,0.06)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#FF5C18]">
              AI Strategy Mode
            </p>
            <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">
              Your weekly strategy
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Claude analyzes your search state and generates a personalized weekly plan.
            </p>
          </div>

          <div className="flex flex-shrink-0 flex-col items-end gap-2">
            {strategy && generatedAt && (
              <p className="text-[10px] text-slate-400">
                Generated at {generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
            <button
              type="button"
              onClick={generateStrategy}
              disabled={isLoading}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60 ${
                strategy
                  ? "border border-slate-200 bg-slate-800 text-white hover:bg-slate-700"
                  : "bg-[#ea580c] hover:bg-[#c2410c]"
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating…
                </>
              ) : strategy ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate my strategy
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Error state ── */}
        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── Loading state ── */}
        {isLoading && (
          <div className="mt-5 flex flex-col items-center gap-3 py-6 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ea580c]">
              <Sparkles className="h-6 w-6 animate-pulse text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Scout is analyzing your search state…
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                This takes 5–10 seconds. Scout reads your applications, resume, and behavior signals.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Strategy sections ── */}
      {strategy && !isLoading && (
        <>
          {/* 2-column grid: Focus + Prioritize */}
          <div className="grid gap-4 sm:grid-cols-2">
            {SECTIONS.slice(0, 2).map((cfg) => (
              <SectionCard
                key={cfg.key}
                config={cfg}
                items={strategy[cfg.key]}
                locked={isLocked(cfg.key)}
                onUnlock={() => showUpgrade("scout_strategy")}
              />
            ))}
          </div>

          {/* 2-column grid: Avoid + Improve */}
          <div className="grid gap-4 sm:grid-cols-2">
            {SECTIONS.slice(2, 4).map((cfg) => (
              <SectionCard
                key={cfg.key}
                config={cfg}
                items={strategy[cfg.key]}
                locked={isLocked(cfg.key)}
                onUnlock={() => showUpgrade("scout_strategy")}
              />
            ))}
          </div>

          {/* This Week — full width */}
          <ThisWeekCard items={strategy.thisWeek} />

          {/* Quick actions — full width */}
          <ActionsCard
            actions={strategy.actions}
            onExecute={(action) => executeAction(action, { source: "strategy" })}
            feedback={feedback}
          />

          {/* Upgrade nudge for free users */}
          {gated && (
            <div className="flex items-start gap-3 rounded-[18px] border border-amber-200 bg-amber-50 px-5 py-4">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">Full strategy locked</p>
                <p className="mt-0.5 text-xs text-amber-800">{gated.upgradeMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => showUpgrade(gated.feature)}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
              >
                Upgrade
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
