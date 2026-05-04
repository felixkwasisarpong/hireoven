"use client"

import { useEffect, useState } from "react"
import { Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type StepState = "pending" | "active" | "done"

type Props = {
  steps: string[]
  /** External "active step index" — when provided, takes precedence over the auto-advance timer. */
  activeStep?: number
  /** Auto-advance steps every N ms when no activeStep is provided. Default: 1100ms. */
  intervalMs?: number
}

export function ScoutProgressSteps({ steps, activeStep, intervalMs = 1100 }: Props) {
  const [autoIndex, setAutoIndex] = useState(0)

  useEffect(() => {
    if (typeof activeStep === "number") return
    const id = window.setInterval(() => {
      setAutoIndex((i) => (i + 1 < steps.length ? i + 1 : i))
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [activeStep, intervalMs, steps.length])

  const current = typeof activeStep === "number" ? activeStep : autoIndex

  return (
    <ol className="space-y-2">
      {steps.map((label, i) => {
        const state: StepState = i < current ? "done" : i === current ? "active" : "pending"
        return (
          <li
            key={label}
            style={{ animationDelay: `${i * 80}ms` }}
            className="flex items-center gap-3 motion-safe:animate-[scoutFadeUp_0.4s_ease-out_both]"
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                state === "done"   && "bg-emerald-500 text-white",
                state === "active" && "bg-[#FF5C18] text-white shadow-[0_0_0_4px_rgba(255,92,24,0.18)]",
                state === "pending" && "bg-slate-100 text-slate-400 ring-1 ring-slate-200",
              )}
            >
              {state === "done" ? (
                <Check className="h-3 w-3" />
              ) : state === "active" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className="h-1 w-1 rounded-full bg-current" />
              )}
            </span>
            <span
              className={cn(
                "text-[13px] transition-colors duration-300",
                state === "done"   && "text-slate-500",
                state === "active" && "font-medium text-slate-900",
                state === "pending" && "text-slate-400",
              )}
            >
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
