"use client"

import { type BillingInterval } from "@/lib/pricing"

export type PricingTheme = "app" | "terminal"

interface BillingToggleProps {
  value: BillingInterval
  onChange: (v: BillingInterval) => void
  theme?: PricingTheme
}

export default function BillingToggle({ value, onChange, theme = "app" }: BillingToggleProps) {
  const t = theme === "terminal"
  const container = t
    ? "flex items-center border border-[rgba(120,200,160,0.26)] bg-[#0e1411] p-1"
    : "flex items-center rounded-full border border-slate-200 bg-slate-50 p-1 shadow-sm"
  const btn = (active: boolean) =>
    [
      t ? "px-5 py-2" : "rounded-full px-5 py-2",
      "text-sm font-semibold transition-all duration-200",
      active
        ? t
          ? "bg-[#111a15] text-white"
          : "bg-white text-slate-900 shadow-sm"
        : t
          ? "text-[#ccd6cf]/55 hover:text-[#38e08a]"
          : "text-slate-500 hover:text-slate-700",
    ].join(" ")
  const saveBadge = t
    ? "whitespace-nowrap border border-[#f5a623]/25 bg-[#f5a623]/12 px-2.5 py-1 text-xs font-bold text-[#f5a623]"
    : "whitespace-nowrap rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-700"

  return (
    <div className="flex items-center justify-center gap-3">
      <div className={container}>
        <button type="button" onClick={() => onChange("monthly")} className={btn(value === "monthly")}>
          Monthly
        </button>
        <button type="button" onClick={() => onChange("yearly")} className={btn(value === "yearly")}>
          Yearly
        </button>
      </div>

      <div
        className={`overflow-hidden transition-all duration-300 ${
          value === "yearly" ? "max-w-[90px] opacity-100" : "max-w-0 opacity-0"
        }`}
      >
        <span className={saveBadge}>Save 35%</span>
      </div>
    </div>
  )
}
