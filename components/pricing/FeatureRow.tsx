"use client"

import { useState } from "react"
import { Check, HelpCircle, Minus } from "lucide-react"

interface FeatureRowProps {
  feature: string
  free: boolean | string | number
  pro: boolean | string | number
  proIntl: boolean | string | number
  tooltip?: string
  isGroupHeader?: boolean
}

function Cell({ value }: { value: boolean | string | number }) {
  if (value === true)
    return (
      <div className="flex justify-center">
        <Check className="h-4.5 w-4.5 text-emerald-500" strokeWidth={2.5} />
      </div>
    )
  if (value === false)
    return (
      <div className="flex justify-center">
        <Minus className="h-4 w-4 text-slate-300" />
      </div>
    )
  return <div className="text-center text-sm font-medium text-slate-700">{value}</div>
}

export default function FeatureRow({
  feature,
  free,
  pro,
  proIntl,
  tooltip,
  isGroupHeader = false,
}: FeatureRowProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  if (isGroupHeader) {
    return (
      <tr className="bg-slate-50/80">
        <td colSpan={4} className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
          {feature}
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
      <td className="px-4 py-3 text-sm text-slate-700">
        <div className="flex items-center gap-1.5">
          {feature}
          {tooltip && (
            <div className="relative">
              <button
                type="button"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                className="text-slate-300 hover:text-slate-500 transition-colors"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
              {showTooltip && (
                <div className="absolute bottom-full left-1/2 z-20 mb-1.5 w-48 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-lg">
                  {tooltip}
                  <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-white" />
                </div>
              )}
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <Cell value={free} />
      </td>
      <td className="px-4 py-3 bg-[#F0FDFA]/60">
        <Cell value={pro} />
      </td>
      <td className="px-4 py-3">
        <Cell value={proIntl} />
      </td>
    </tr>
  )
}
