"use client"

import { cn } from "@/lib/utils"

type Lang = "python" | "javascript"

const OPTIONS: { id: Lang; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
]

type Props = {
  value: Lang
  onChange: (v: Lang) => void
  disabled?: boolean
}

export default function LanguageToggle({ value, onChange, disabled }: Props) {
  return (
    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.id)}
          className={cn(
            "rounded-md px-3 py-1 text-[12px] font-semibold transition",
            value === opt.id
              ? "bg-white shadow-sm text-slate-900"
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
