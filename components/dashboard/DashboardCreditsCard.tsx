"use client"

import { useQuotas } from "@/lib/hooks/useQuotas"
import { METERED_FEATURE_KEYS, type MeteredFeature, type QuotaConfig, type QuotaState } from "@/lib/usage/quotas"
import { cn } from "@/lib/utils"

function pctUsed(state: QuotaState): number {
  if (state.limit <= 0) return 100
  return Math.min(100, Math.round((state.used / state.limit) * 100))
}

function barColor(state: QuotaState): string {
  const pct = pctUsed(state)
  if (state.exceeded) return "bg-rose-500"
  if (pct >= 80) return "bg-amber-500"
  return "bg-emerald-500"
}

function periodSuffix(config: QuotaConfig): string {
  return config.period === "day" ? "today" : "this month"
}

export default function DashboardCreditsCard({
  variant = "light",
}: {
  variant?: "light" | "dark"
} = {}) {
  const { quotas, config, isLoading } = useQuotas()

  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        variant === "dark"
          ? "border-white/10 bg-white/[0.03]"
          : "border-[#E2E6F0] bg-white"
      )}
    >
      <div className="flex items-center justify-between">
        <p
          className={cn(
            "text-[11px] font-bold uppercase tracking-wider",
            variant === "dark" ? "text-slate-300" : "text-[#64729A]"
          )}
        >
          Credits
        </p>
      </div>

      <ul className="mt-2 space-y-2">
        {METERED_FEATURE_KEYS.map((feature) => {
          const state = quotas?.[feature]
          const cfg = config?.[feature]
          return (
            <li key={feature}>
              <CreditRow
                state={state}
                config={cfg}
                feature={feature}
                variant={variant}
                loading={isLoading}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CreditRow({
  state,
  config,
  feature,
  variant,
  loading,
}: {
  state: QuotaState | undefined
  config: QuotaConfig | undefined
  feature: MeteredFeature
  variant: "light" | "dark"
  loading: boolean
}) {
  const label = config?.shortLabel ?? feature
  const limit = state?.limit ?? config?.limits.free ?? 0
  const used = state?.used ?? 0
  const remaining = state ? state.remaining : limit

  const labelClass = variant === "dark" ? "text-slate-200" : "text-[#1F2A44]"
  const subClass = variant === "dark" ? "text-slate-400" : "text-[#64729A]"
  const trackClass = variant === "dark" ? "bg-white/10" : "bg-[#EEF1F8]"

  return (
    <div title={config ? `${used} of ${limit} ${label.toLowerCase()} used ${periodSuffix(config)}` : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("truncate text-[12px] font-medium", labelClass)}>{label}</span>
        <span className={cn("shrink-0 text-[11px] tabular-nums font-semibold", subClass)}>
          {loading || !state ? "—" : `${remaining}/${limit}`}
        </span>
      </div>
      <div className={cn("mt-1 h-1.5 w-full overflow-hidden rounded-full", trackClass)}>
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", state ? barColor(state) : "bg-transparent")}
          style={{ width: state ? `${pctUsed(state)}%` : "0%" }}
        />
      </div>
    </div>
  )
}
