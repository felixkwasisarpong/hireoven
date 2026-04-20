"use client"

import { type BillingInterval } from "@/lib/pricing"

interface BillingToggleProps {
  value: BillingInterval
  onChange: (v: BillingInterval) => void
}

export default function BillingToggle({ value, onChange }: BillingToggleProps) {
  return (
    <div className="flex items-center justify-center gap-3">
      <div className="flex items-center rounded-full border border-slate-200 bg-slate-50 p-1 shadow-sm">
        <button
          type="button"
          onClick={() => onChange("monthly")}
          className={`rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 ${
            value === "monthly"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => onChange("yearly")}
          className={`rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 ${
            value === "yearly"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Yearly
        </button>
      </div>

      <div
        className={`overflow-hidden transition-all duration-300 ${
          value === "yearly" ? "max-w-[90px] opacity-100" : "max-w-0 opacity-0"
        }`}
      >
        <span className="whitespace-nowrap rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-700">
          Save 35%
        </span>
      </div>
    </div>
  )
}
