"use client"

import { Lightbulb } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  hintsUsed: number
  hintsTotal: number
  onHint: () => void
  disabled?: boolean
}

export default function HintButton({ hintsUsed, hintsTotal, onHint, disabled }: Props) {
  const exhausted = hintsUsed >= hintsTotal
  const title = exhausted ? "No more hints. Try talking it through." : `Hint (${hintsUsed}/${hintsTotal} used)`

  return (
    <button
      type="button"
      onClick={onHint}
      disabled={disabled || exhausted}
      title={title}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition",
        exhausted
          ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
          : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
      )}
    >
      <Lightbulb className="h-3.5 w-3.5" strokeWidth={2} />
      Hint {hintsUsed}/{hintsTotal}
    </button>
  )
}
