"use client"

import { useState } from "react"
import { Check, HelpCircle, Minus } from "lucide-react"
import type { PricingTheme } from "./BillingToggle"

interface FeatureRowProps {
  feature: string
  free: boolean | string | number
  pro: boolean | string | number
  proMax: boolean | string | number
  tooltip?: string
  isGroupHeader?: boolean
  theme?: PricingTheme
}

function Cell({ value, terminal }: { value: boolean | string | number; terminal: boolean }) {
  if (value === true)
    return (
      <div className="flex justify-center">
        <Check className={terminal ? "h-4.5 w-4.5 text-[#38e08a]" : "h-4.5 w-4.5 text-emerald-500"} strokeWidth={2.5} />
      </div>
    )
  if (value === false)
    return (
      <div className="flex justify-center">
        <Minus className={terminal ? "h-4 w-4 text-[#ccd6cf]/30" : "h-4 w-4 text-slate-300"} />
      </div>
    )
  return (
    <div className={terminal ? "text-center text-sm font-medium text-[#ccd6cf]/80" : "text-center text-sm font-medium text-slate-700"}>
      {value}
    </div>
  )
}

export default function FeatureRow({
  feature,
  free,
  pro,
  proMax,
  tooltip,
  isGroupHeader = false,
  theme = "app",
}: FeatureRowProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const t = theme === "terminal"

  if (isGroupHeader) {
    return (
      <tr className={t ? "bg-[#0a0e0c]" : "bg-slate-50/80"}>
        <td
          colSpan={4}
          className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] ${t ? "text-[#ccd6cf]/55" : "text-slate-500"}`}
        >
          {feature}
        </td>
      </tr>
    )
  }

  return (
    <tr
      className={
        t
          ? "border-t border-[rgba(120,200,160,0.12)] hover:bg-[#111a15] transition-colors"
          : "border-t border-slate-100 hover:bg-slate-50/50 transition-colors"
      }
    >
      <td className={`px-4 py-3 text-sm ${t ? "text-[#ccd6cf]/80" : "text-slate-700"}`}>
        <div className="flex items-center gap-1.5">
          {feature}
          {tooltip && (
            <div className="relative">
              <button
                type="button"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                aria-label={`More info about ${feature}`}
                className={t ? "text-[#ccd6cf]/35 hover:text-[#38e08a] transition-colors" : "text-slate-300 hover:text-slate-500 transition-colors"}
              >
                <HelpCircle className="h-3.5 w-3.5" aria-hidden />
              </button>
              {showTooltip && (
                <div
                  className={
                    t
                      ? "absolute bottom-full left-1/2 z-20 mb-1.5 w-48 -translate-x-1/2 border border-[rgba(120,200,160,0.26)] bg-[#0e1411] px-3 py-2 text-xs text-[#ccd6cf]/70"
                      : "absolute bottom-full left-1/2 z-20 mb-1.5 w-48 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-lg"
                  }
                >
                  {tooltip}
                  <div className={`absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent ${t ? "border-t-[#0e1411]" : "border-t-white"}`} />
                </div>
              )}
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <Cell value={free} terminal={t} />
      </td>
      <td className={`px-4 py-3 ${t ? "bg-[#38e08a]/[0.06]" : "bg-[#F0FDFA]/60"}`}>
        <Cell value={pro} terminal={t} />
      </td>
      <td className="px-4 py-3">
        <Cell value={proMax} terminal={t} />
      </td>
    </tr>
  )
}
