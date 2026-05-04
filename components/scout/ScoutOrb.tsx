"use client"

import { cn } from "@/lib/utils"

type Props = {
  state?: "idle" | "thinking" | "done" | "speaking"
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZES = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-14 w-14",
} as const

/**
 * Scout brand orb — violet-to-orange gradient, clean glow, no gimmicks.
 * idle: slow gentle breath · thinking: faster + stronger glow · done: pop
 */
export function ScoutOrb({ state = "idle", size = "md", className }: Props) {
  const isActive = state === "thinking" || state === "speaking"

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        SIZES[size],
        className
      )}
    >
      {/* Outer glow ring — active states only */}
      {isActive && (
        <span
          className="pointer-events-none absolute inset-[-3px] rounded-full motion-safe:animate-[scoutOrbAura_1.6s_ease-out_infinite]"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.3) 0%, transparent 70%)" }}
        />
      )}

      {/* Core sphere */}
      <span
        className={cn(
          "relative inline-flex h-full w-full items-center justify-center rounded-full",
          "motion-safe:animate-[scoutOrbBreath_3s_ease-in-out_infinite]",
          state === "thinking" && "motion-safe:[animation-duration:1s]",
          state === "done"     && "motion-safe:animate-[scoutOrbDone_0.4s_ease-out_both]",
          state === "speaking" && "motion-safe:[animation-duration:1.4s]"
        )}
        style={{
          background: "linear-gradient(135deg, #7C3AED 0%, #C026D3 35%, #FF5C18 75%, #FF9A3C 100%)",
          boxShadow: isActive
            ? "0 0 0 2px rgba(124,58,237,0.25), 0 4px_20px_-2px_rgba(124,58,237,0.45), 0 0 24px rgba(255,92,24,0.35)"
            : "0 2px 12px -2px rgba(124,58,237,0.4), 0 1px 4px rgba(0,0,0,0.12)",
        }}
      >
        {/* Top-left specular */}
        <span className="absolute left-[15%] top-[12%] h-[30%] w-[30%] rounded-full bg-white/40 blur-[2px]" />
        {/* Spark icon — a simple 4-point star in SVG */}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className={cn(
            "relative drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)]",
            size === "sm" ? "h-[42%] w-[42%]" : size === "md" ? "h-[40%] w-[40%]" : "h-[38%] w-[38%]"
          )}
        >
          <path
            d="M10 2 L11.2 8.8 L18 10 L11.2 11.2 L10 18 L8.8 11.2 L2 10 L8.8 8.8 Z"
            fill="white"
            fillOpacity="0.95"
          />
        </svg>
      </span>
    </span>
  )
}
