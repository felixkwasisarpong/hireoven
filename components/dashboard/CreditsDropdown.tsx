"use client"

import { useEffect, useRef, useState } from "react"
import { Cross, Video } from "lucide-react"
import { useQuotas } from "@/lib/hooks/useQuotas"
import { useSubscription } from "@/lib/context/SubscriptionContext"
import {
  METERED_FEATURE_KEYS,
  type MeteredFeature,
  type QuotaConfig,
  type QuotaState,
} from "@/lib/usage/quotas"
import { cn } from "@/lib/utils"

// ── Quota helpers ─────────────────────────────────────────────────────────────

function pct(state: QuotaState) {
  if (state.limit <= 0) return 100
  return Math.min(100, Math.round((state.used / state.limit) * 100))
}

function barColor(state: QuotaState) {
  if (state.exceeded) return "bg-rose-500"
  if (pct(state) >= 80) return "bg-amber-500"
  return "bg-emerald-500"
}

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

// ── Live credits ──────────────────────────────────────────────────────────────

type LiveCredits = {
  balance: number
  costs: { short: number; long: number }
}

function useLiveCredits(enabled: boolean) {
  const [credits, setCredits] = useState<LiveCredits | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    setLoading(true)
    fetch("/api/interview/credits/balance")
      .then((r) => r.json())
      .then((d) => setCredits({ balance: d.balance ?? 0, costs: d.costs ?? { short: 1, long: 1 } }))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [enabled])

  function refresh() {
    if (!enabled) return
    fetch("/api/interview/credits/balance")
      .then((r) => r.json())
      .then((d) => setCredits({ balance: d.balance ?? 0, costs: d.costs ?? { short: 1, long: 1 } }))
      .catch(() => {})
  }

  return { credits, loading, refresh }
}

// ── Credit pack buy button ────────────────────────────────────────────────────

const PACKS = [
  { key: "session_short_1", label: "30-min", price: "$12" },
  { key: "session_long_1",  label: "60-min", price: "$20" },
  { key: "session_short_3", label: "3×30min", price: "$30" },
  { key: "session_short_5", label: "5×30min", price: "$45" },
] as const

function BuyPackButton({
  packKey,
  label,
  price,
  highlight,
  onBought,
}: {
  packKey: string
  label: string
  price: string
  highlight?: boolean
  onBought: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function buy() {
    setBusy(true)
    try {
      const res = await fetch("/api/interview/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: packKey }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={buy}
      disabled={busy}
      className={cn(
        "flex flex-col items-center rounded-lg border px-2.5 py-1.5 text-center transition disabled:opacity-60",
        highlight
          ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      )}
    >
      <span className="text-[12px] font-semibold">{label}</span>
      <span className="text-[10px] text-slate-400">{price}</span>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CreditsDropdown() {
  const { quotas, config, isLoading } = useQuotas()
  const { isProMax } = useSubscription()
  const { credits, loading: liveLoading, refresh: refreshLive } = useLiveCredits(isProMax)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [open])

  // Refresh live credits when the dropdown opens
  useEffect(() => {
    if (open && isProMax) refreshLive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isProMax])

  const worst = mostConstrained(quotas ?? null)
  const worstPct = worst ? pct(worst) : 0
  const liveEmpty = isProMax && credits !== null && credits.balance === 0

  // Trigger colour: rose if any quota exceeded or live credits empty, amber at 80%
  const triggerColor =
    (worst?.exceeded || liveEmpty)
      ? "text-rose-700 border-rose-200 bg-rose-100 hover:bg-rose-200"
      : worstPct >= 80
        ? "text-amber-800 border-amber-200 bg-amber-100 hover:bg-amber-200"
        : "text-slate-700 border-slate-200 bg-slate-100 hover:bg-slate-200"

  return (
    <div ref={ref} className="relative">
      {/* ── Trigger ── */}
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

        {/* Most-constrained quota counter */}
        {!isLoading && worst && (
          <span className="ml-0.5 tabular-nums opacity-70">
            {worst.remaining}/{worst.limit}
          </span>
        )}

        {/* Mini quota progress bar */}
        <span className="block h-1.5 w-10 overflow-hidden rounded-full bg-slate-200">
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-300",
              worst ? barColor(worst) : "bg-transparent"
            )}
            style={{ width: worst ? `${worstPct}%` : "0%" }}
          />
        </span>

        {/* Live credits pill — only for Pro Max */}
        {isProMax && (
          <>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Video className="h-3 w-3 shrink-0" />
              <span className={cn("tabular-nums", liveEmpty ? "text-rose-600" : "")}>
                {liveLoading || credits === null ? "—" : credits.balance}
              </span>
            </span>
          </>
        )}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          {/* Period quotas */}
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

          {/* Live interview credits — Pro Max only */}
          {isProMax && (
            <>
              <div className="my-3 border-t border-slate-100" />
              <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                Live interview credits
              </p>

              {liveLoading ? (
                <div className="h-6 animate-pulse rounded bg-slate-100" />
              ) : (
                <>
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
                      <Video className="h-3.5 w-3.5 text-orange-500" />
                      {credits?.balance ?? 0} session{(credits?.balance ?? 0) !== 1 ? "s" : ""}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      $12 / 30 min · $20 / 60 min
                    </span>
                  </div>

                  {/* Low-balance warning */}
                  {(credits?.balance ?? 0) === 0 && (
                    <p className="mb-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-600">
                      No sessions — buy a pack to run a live interview.
                    </p>
                  )}
                  {(credits?.balance ?? 0) === 1 && (
                    <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
                      1 session left — consider topping up.
                    </p>
                  )}

                  {/* Buy pack grid */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {PACKS.map((p) => (
                      <BuyPackButton
                        key={p.key}
                        packKey={p.key}
                        label={p.label}
                        price={p.price}
                        highlight={p.key === "session_short_1" || p.key === "session_short_3"}
                        onBought={refreshLive}
                      />
                    ))}
                  </div>

                  <p className="mt-2 text-center text-[10px] text-slate-400">
                    Pro Max includes 2 free sessions/month
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Quota row ─────────────────────────────────────────────────────────────────

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
