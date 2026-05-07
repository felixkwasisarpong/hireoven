"use client"

import { useEffect, useRef, useState } from "react"
import { Cross } from "lucide-react"
import { useQuotas } from "@/lib/hooks/useQuotas"
import { METERED_FEATURE_KEYS, type MeteredFeature, type QuotaConfig, type QuotaState } from "@/lib/usage/quotas"
import { cn } from "@/lib/utils"

function pct(state: QuotaState) {
  if (state.limit <= 0) return 100
  return Math.min(100, Math.round((state.used / state.limit) * 100))
}

function barColor(state: QuotaState) {
  if (state.exceeded) return "bg-rose-500"
  if (pct(state) >= 80) return "bg-amber-500"
  return "bg-emerald-500"
}

function pillColor(state: QuotaState) {
  if (state.exceeded) return "text-rose-600 border-rose-200 bg-rose-50"
  if (pct(state) >= 80) return "text-amber-700 border-amber-200 bg-amber-50"
  return "text-slate-600 border-slate-200 bg-white"
}

// Find the most-constrained quota (highest % used) to surface in the trigger
function mostConstrained(quotas: Record<MeteredFeature, QuotaState> | null) {
  if (!quotas) return null
  let worst: QuotaState | null = null
  for (const key of METERED_FEATURE_KEYS) {
    const s = quotas[key]
    if (!s) continue
    if (!worst || pct(s) > pct(worst)) worst = s
  }
  return worst
}

export default function CreditsDropdown() {
  const { quotas, config, isLoading } = useQuotas()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [open])

  const worst = mostConstrained(quotas ?? null)
  const worstPct = worst ? pct(worst) : 0

  const triggerColor = worst
    ? worst.exceeded
      ? "text-rose-700 border-rose-200 bg-rose-100 hover:bg-rose-200"
      : worstPct >= 80
        ? "text-amber-800 border-amber-200 bg-amber-100 hover:bg-amber-200"
        : "text-slate-700 border-slate-200 bg-slate-100 hover:bg-slate-200"
    : "text-slate-700 border-slate-200 bg-slate-100 hover:bg-slate-200"

  return (
    <div ref={ref} className="relative">
      {/* ── Trigger bar ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
          triggerColor
        )}
      >
        <Cross className="h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2.5} />
        <span>Credits</span>
        {!isLoading && worst && (
          <span className="ml-0.5 tabular-nums opacity-70">
            {worst.remaining}/{worst.limit}
          </span>
        )}
        {/* Mini progress bar */}
        <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-300",
              worst ? barColor(worst) : "bg-transparent"
            )}
            style={{ width: worst ? `${worstPct}%` : "0%" }}
          />
        </span>
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-2.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Usage this period
          </p>
          <ul className="space-y-2.5">
            {METERED_FEATURE_KEYS.map((feature) => {
              const state = quotas?.[feature]
              const cfg = config?.[feature]
              return (
                <li key={feature}>
                  <QuotaRow feature={feature} state={state} config={cfg} loading={isLoading} />
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function QuotaRow({
  feature,
  state,
  config,
  loading,
}: {
  feature: MeteredFeature
  state: QuotaState | undefined
  config: QuotaConfig | undefined
  loading: boolean
}) {
  const label = config?.shortLabel ?? feature
  const limit = state?.limit ?? config?.limits.free ?? 0
  const remaining = state ? state.remaining : limit
  const used = state?.used ?? 0

  return (
    <div title={state ? `${used} of ${limit} used` : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12.5px] font-medium text-slate-700">{label}</span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">
          {loading || !state ? "—" : `${remaining} left`}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            state ? barColor(state) : "bg-transparent"
          )}
          style={{ width: state ? `${pct(state)}%` : "0%" }}
        />
      </div>
    </div>
  )
}
