"use client"

import { cn } from "@/lib/utils"
import type { CodingLanguage } from "@/lib/scout/interview/codingRunner"

const OPTIONS: { id: CodingLanguage; label: string }[] = [
  { id: "python",     label: "Python" },
  { id: "javascript", label: "JS" },
  { id: "typescript", label: "TS" },
  { id: "go",         label: "Go" },
  { id: "java",       label: "Java" },
]

type Props = {
  value: CodingLanguage
  onChange: (v: CodingLanguage) => void
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
            "rounded-md px-2.5 py-1 text-[12px] font-semibold transition",
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
